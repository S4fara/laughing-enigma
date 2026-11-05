import { create } from 'zustand';
import { db, type Track } from './db';

const audio = new Audio();
audio.preload = 'auto';

let objectUrl: string | null = null;
let loadToken = 0;
let unlocked = false;

// iOS разрешает play() только внутри жеста пользователя. Из-за await к базе
// жест «теряется», поэтому первым тапом запускаем тишину на этом же элементе:
// после этого он может играть любые следующие треки.
const SILENCE = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';

interface PlayerState {
  queue: Track[];
  index: number;
  playing: boolean;
  current: number;
  duration: number;
  playQueue: (tracks: Track[], start: number) => void;
  toggle: () => void;
  next: () => void;
  prev: () => void;
  seek: (t: number) => void;
}

export const usePlayer = create<PlayerState>((set, get) => {
  async function load(i: number) {
    const track = get().queue[i];
    if (!track) return;
    const mine = ++loadToken;
    set({ index: i, current: 0, duration: track.duration });
    const file = await db.files.get(track.id);
    if (mine !== loadToken || !file) return;
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = URL.createObjectURL(file.blob);
    audio.src = objectUrl;
    setSessionMetadata(track);
    try {
      await audio.play();
    } catch (e) {
      console.warn('play() не удался', e);
    }
  }

  return {
    queue: [],
    index: 0,
    playing: false,
    current: 0,
    duration: 0,

    playQueue: (tracks, start) => {
      if (!unlocked) {
        unlocked = true;
        audio.src = SILENCE;
        audio.play().catch(() => {});
      }
      set({ queue: tracks });
      void load(start);
    },
    toggle: () => {
      if (!get().queue.length) return;
      if (audio.paused) void audio.play();
      else audio.pause();
    },
    next: () => {
      const { index, queue } = get();
      if (index + 1 < queue.length) void load(index + 1);
      else {
        audio.pause();
        audio.currentTime = 0;
      }
    },
    prev: () => {
      const { index } = get();
      if (audio.currentTime > 3 || index === 0) {
        audio.currentTime = 0;
      } else {
        void load(index - 1);
      }
    },
    seek: (t) => {
      audio.currentTime = t;
      set({ current: t });
    }
  };
});

// --- события аудио ---
audio.addEventListener('play', () => usePlayer.setState({ playing: true }));
audio.addEventListener('pause', () => usePlayer.setState({ playing: false }));
audio.addEventListener('ended', () => usePlayer.getState().next());
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
function setSessionMetadata(t: Track) {
  if (!('mediaSession' in navigator)) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: t.title,
    artist: t.artist,
    album: t.album
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
