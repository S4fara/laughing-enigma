import { create } from 'zustand';
import { db, type Track } from './db';
import { ensureFile } from './cloud';

const audio = new Audio();
audio.preload = 'auto';

let objectUrl: string | null = null;
let loadToken = 0;
let unlocked = false;

// iOS разрешает play() только внутри жеста пользователя. Из-за await к базе
// жест «теряется», поэтому первым тапом запускаем тишину на этом же элементе:
// после этого он может играть любые следующие треки.
const SILENCE = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';

export type Repeat = 'off' | 'all' | 'one';

// --- сохранённые настройки ---
const KEY = 'player-prefs';
interface Prefs {
  volume: number;
  shuffle: boolean;
  repeat: Repeat;
}
function loadPrefs(): Prefs {
  const base: Prefs = { volume: 1, shuffle: false, repeat: 'off' };
  try {
    return { ...base, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    return base;
  }
}
function savePrefs(p: Prefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // хранилище недоступно — не критично
  }
}
const prefs = loadPrefs();

// iOS не даёт менять audio.volume (всегда 1): там громкость только кнопками телефона.
audio.volume = 0.5;
const volumeSupported = audio.volume === 0.5;
const startVolume = volumeSupported ? Math.min(1, Math.max(0, Number(prefs.volume) || 0)) : 1;
audio.volume = startVolume;

// --- порядок воспроизведения ---
function makeOrder(n: number, start: number, shuffle: boolean) {
  if (!shuffle) return { order: Array.from({ length: n }, (_, i) => i), pos: start };
  const rest = Array.from({ length: n }, (_, i) => i).filter((i) => i !== start);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  return { order: [start, ...rest], pos: 0 };
}
function randomExcept(except: number, n: number) {
  if (n <= 1) return 0;
  const r = Math.floor(Math.random() * (n - 1));
  return r >= except ? r + 1 : r;
}

interface PlayerState {
  queue: Track[];
  index: number; // индекс текущего трека в queue
  order: number[]; // порядок проигрывания (индексы queue)
  pos: number; // позиция в order
  playing: boolean;
  current: number;
  duration: number;
  shuffle: boolean;
  repeat: Repeat;
  volume: number;
  volumeSupported: boolean;
  loading: boolean;
  error: string | null;
  playQueue: (tracks: Track[], start: number) => void;
  toggle: () => void;
  next: () => void;
  prev: () => void;
  ended: () => void;
  seek: (t: number) => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  setVolume: (v: number) => void;
}

export const usePlayer = create<PlayerState>((set, get) => {
  async function load(i: number) {
    const track = get().queue[i];
    if (!track) return;
    const mine = ++loadToken;
    set({ index: i, current: 0, duration: track.duration, loading: false, error: null });
    let blob: Blob | undefined;
    try {
      const local = await db.files.get(track.id);
      if (local) blob = local.blob;
      else if (track.remoteId) {
        set({ loading: true });
        blob = await ensureFile(track);
      }
    } catch (e) {
      if (mine === loadToken) set({ loading: false, error: e instanceof Error ? e.message : 'Не удалось загрузить трек' });
      return;
    }
    if (mine !== loadToken) return;
    set({ loading: false });
    if (!blob) return;
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = URL.createObjectURL(blob);
    audio.src = objectUrl;
    setSessionMetadata(track);
    void db.tracks.where('id').equals(track.id).modify((t) => {
      t.lastPlayedAt = Date.now();
      t.plays = (t.plays ?? 0) + 1;
    });
    try {
      await audio.play();
    } catch (e) {
      console.warn('play() не удался', e);
    }
  }

  function go(pos: number) {
    set({ pos });
    void load(get().order[pos]);
  }

  function persist() {
    const { volume, shuffle, repeat } = get();
    savePrefs({ volume, shuffle, repeat });
  }

  return {
    queue: [],
    index: 0,
    order: [],
    pos: 0,
    playing: false,
    current: 0,
    duration: 0,
    shuffle: prefs.shuffle,
    repeat: prefs.repeat,
    volume: startVolume,
    volumeSupported,
    loading: false,
    error: null,

    playQueue: (tracks, start) => {
      if (!unlocked) {
        unlocked = true;
        audio.src = SILENCE;
        audio.play().catch(() => {});
      }
      const { order, pos } = makeOrder(tracks.length, start, get().shuffle);
      set({ queue: tracks, order, pos });
      void load(order[pos]);
    },
    toggle: () => {
      if (!get().queue.length) return;
      if (audio.paused) void audio.play();
      else audio.pause();
    },
    next: () => {
      const { order, pos, repeat, queue, shuffle, index } = get();
      if (pos + 1 < order.length) {
        go(pos + 1);
      } else if (repeat === 'all' && queue.length) {
        const m = makeOrder(queue.length, shuffle ? randomExcept(index, queue.length) : 0, shuffle);
        set({ order: m.order, pos: 0 });
        void load(m.order[0]);
      } else {
        audio.pause();
        audio.currentTime = 0;
      }
    },
    prev: () => {
      const { pos } = get();
      if (audio.currentTime > 3 || pos === 0) audio.currentTime = 0;
      else go(pos - 1);
    },
    ended: () => {
      if (get().repeat === 'one') {
        audio.currentTime = 0;
        void audio.play();
      } else {
        get().next();
      }
    },
    seek: (t) => {
      audio.currentTime = t;
      set({ current: t });
    },
    toggleShuffle: () => {
      const { queue, index, shuffle } = get();
      const s = !shuffle;
      if (!queue.length) {
        set({ shuffle: s });
      } else {
        const m = makeOrder(queue.length, index, s);
        set({ shuffle: s, order: m.order, pos: m.pos });
      }
      persist();
    },
    cycleRepeat: () => {
      const r = get().repeat;
      set({ repeat: r === 'off' ? 'all' : r === 'all' ? 'one' : 'off' });
      persist();
    },
    setVolume: (v) => {
      if (volumeSupported) audio.volume = v;
      set({ volume: v });
      persist();
    }
  };
});

// --- события аудио ---
audio.addEventListener('play', () => usePlayer.setState({ playing: true }));
audio.addEventListener('pause', () => usePlayer.setState({ playing: false }));
audio.addEventListener('ended', () => usePlayer.getState().ended());
audio.addEventListener('loadedmetadata', () => {
  if (isFinite(audio.duration)) usePlayer.setState({ duration: audio.duration });
});
audio.addEventListener('timeupdate', () => {
  usePlayer.setState({ current: audio.currentTime });
  if ('mediaSession' in navigator && isFinite(audio.duration)) {
    try {
      navigator.mediaSession.setPositionState({
        duration: audio.duration,
        position: audio.currentTime,
        playbackRate: audio.playbackRate
      });
    } catch {
      // некоторые браузеры капризничают с positionState
    }
  }
});

// --- экран блокировки / Пункт управления ---
let artUrl: string | null = null;
function setSessionMetadata(t: Track) {
  if (!('mediaSession' in navigator)) return;
  if (artUrl) URL.revokeObjectURL(artUrl);
  artUrl = t.cover ? URL.createObjectURL(t.cover) : null;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: t.title,
    artist: t.artist,
    album: t.album,
    artwork: artUrl ? [{ src: artUrl, sizes: '400x400', type: 'image/jpeg' }] : []
  });
}

if ('mediaSession' in navigator) {
  const set = (a: MediaSessionAction, h: MediaSessionActionHandler) => {
    try {
      navigator.mediaSession.setActionHandler(a, h);
    } catch {
      // действие не поддерживается
    }
  };
  set('play', () => void audio.play());
  set('pause', () => audio.pause());
  set('previoustrack', () => usePlayer.getState().prev());
  set('nexttrack', () => usePlayer.getState().next());
  set('seekto', (d) => {
    if (d.seekTime != null) usePlayer.getState().seek(d.seekTime);
  });
}
