import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, deleteTrack, type Playlist, type Track } from './db';
import { importFiles } from './import';
import { backfillCovers, computePeaks } from './meta';
import { usePlayer } from './player';
import * as cloud from './cloud';
import NowPlaying from './NowPlaying';
import CloudTab from './CloudTab';
import { Cover, Icon, P, fmt } from './ui';

type Menu = { track: Track; playlistId?: number } | null;
type Tab = 'tracks' | 'playlists' | 'cloud';

export default function App() {
  const tracks = useLiveQuery(() => db.tracks.orderBy('addedAt').reverse().toArray(), []);
  const playlists = useLiveQuery(() => db.playlists.orderBy('createdAt').toArray(), []);
  const cachedKeys = useLiveQuery(() => db.files.toCollection().primaryKeys(), []);
  const cached = new Set<number>((cachedKeys ?? []) as number[]);
  const [tab, setTab] = useState<Tab>('tracks');
  const [openId, setOpenId] = useState<number | null>(null);
  const [menu, setMenu] = useState<Menu>(null);
  const [full, setFull] = useState(false);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [connected, setConnected] = useState(!!cloud.getCloud());
  const fileInput = useRef<HTMLInputElement>(null);
  const { queue, index, playing, current, duration, loading, error, playQueue, toggle, next, prev, seek } = usePlayer();
  const now = queue[index];
  const cur = useLiveQuery(() => (now ? db.tracks.get(now.id) : undefined), [now?.id]) ?? now;

  useEffect(() => {
    void backfillCovers();
  }, []);
  useEffect(() => {
    if (cur && !cur.peaks && !cur.peaksTried) void computePeaks(cur.id);
  }, [cur?.id, !!cur?.peaks, !!cur?.peaksTried]);

  // автосинхронизация с облаком: при запуске и при возвращении в приложение
  useEffect(() => {
    if (!connected) return;
    const run = () => {
      if (document.visibilityState === 'visible') void cloud.syncIfStale().catch(() => {});
    };
    run();
    document.addEventListener('visibilitychange', run);
    return () => document.removeEventListener('visibilitychange', run);
  }, [connected]);

  const needle = q.trim().toLowerCase();
  const shown =
    tracks && needle
      ? tracks.filter((t) => `${t.title} ${t.artist} ${t.album}`.toLowerCase().includes(needle))
      : tracks;

  const byId = new Map((tracks ?? []).map((t) => [t.id, t]));
  const openPl = playlists?.find((p) => p.id === openId);
  const plTracks = openPl ? openPl.trackIds.map((id) => byId.get(id)).filter((t): t is Track => !!t) : [];
  const compatible = (t: Track) => (playlists ?? []).filter((p) => p.remoteId == null || !!t.remoteId);

  async function guarded(fn: () => Promise<void>) {
    try {
      await fn();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Что-то пошло не так');
    }
  }

  async function onPick(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (!files.length) return;
    await importFiles(files, (done, total) => setStatus(`Добавляем ${done} из ${total}…`));
    setStatus('');
  }

  async function addTo(p: Playlist, t: Track) {
    setMenu(null);
    await guarded(async () => {
      if (p.remoteId != null) {
        await cloud.addToPlaylist(p.remoteId, t.remoteId!);
        await cloud.syncLibrary();
      } else {
        await db.playlists.where('id').equals(p.id).modify((x) => {
          if (!x.trackIds.includes(t.id)) x.trackIds.push(t.id);
        });
      }
    });
  }
  async function addToNew(t: Track) {
    const name = window.prompt('Название плейлиста')?.trim();
    if (!name) return;
    setMenu(null);
    await guarded(async () => {
      if (t.remoteId && connected) {
        const id = await cloud.createPlaylist(name);
        await cloud.addToPlaylist(id, t.remoteId);
        await cloud.syncLibrary();
      } else {
        await db.playlists.add({ name, trackIds: [t.id], createdAt: Date.now() });
      }
    });
  }
  async function removeFrom(pid: number, t: Track) {
    setMenu(null);
    const p = playlists?.find((x) => x.id === pid);
    if (!p) return;
    await guarded(async () => {
      if (p.remoteId != null && t.remoteId) {
        await cloud.removeFromPlaylist(p.remoteId, t.remoteId);
        await cloud.syncLibrary();
      } else {
        await db.playlists.where('id').equals(pid).modify((x) => {
          x.trackIds = x.trackIds.filter((id) => id !== t.id);
        });
      }
    });
  }
  async function removeTrack(t: Track) {
    const text = t.remoteId
      ? `Удалить «${t.title}» из облака? Трек пропадёт на всех устройствах.`
      : `Удалить «${t.title}» из библиотеки?`;
    if (!window.confirm(text)) return;
    setMenu(null);
    await guarded(async () => {
      if (t.remoteId) {
        await cloud.deleteRemoteTrack(t.remoteId);
        await cloud.syncLibrary();
      } else {
        await deleteTrack(t.id);
      }
    });
  }
  async function removePlaylist(p: Playlist) {
    if (!window.confirm(`Удалить плейлист «${p.name}»? Треки останутся в библиотеке.`)) return;
    setOpenId(null);
    await guarded(async () => {
      if (p.remoteId != null) {
        await cloud.deletePlaylist(p.remoteId);
        await cloud.syncLibrary();
      } else {
        await db.playlists.delete(p.id);
      }
    });
  }
  async function download(list: Track[]) {
    const todo = list.filter((t) => t.remoteId && !cached.has(t.id));
    setMenu(null);
    await guarded(async () => {
      try {
        for (let i = 0; i < todo.length; i++) {
          setStatus(`Скачиваем ${i + 1} из ${todo.length}…`);
          await cloud.ensureFile(todo[i]);
        }
      } finally {
        setStatus('');
      }
    });
  }
  async function dropFromDevice(t: Track) {
    setMenu(null);
    await db.files.delete(t.id);
  }

  function renderTrack(t: Track, i: number, list: Track[], playlistId?: number) {
    const remoteOnly = !!t.remoteId && !cached.has(t.id);
    return (
      <div key={t.id} className={'item' + (now?.id === t.id ? ' active' : '')}>
        <button className="track" onClick={() => playQueue(list, i)}>
          <Cover track={t} label={t.title} className="thumb" />
          <span className="t-col">
            <span className="t-title">{t.title}</span>
            <span className="t-sub">{t.artist}</span>
          </span>
        </button>
        <span className="dur">
          {remoteOnly && (
            <span className="cloud-mark" title="Ещё не скачан на устройство">
              <Icon d={P.cloud} size={16} />
            </span>
          )}
          {fmt(t.duration)}
        </span>
        <button className="more" aria-label="Действия с треком" onClick={() => setMenu({ track: t, playlistId })}>
          <Icon d={P.more} />
        </button>
      </div>
    );
  }

  const pct = duration > 0 ? (current / duration) * 100 : 0;
  const title = tab === 'tracks' ? 'Библиотека' : tab === 'cloud' ? 'Облако' : openPl ? openPl.name : 'Плейлисты';
  const needDownload = plTracks.some((t) => t.remoteId && !cached.has(t.id));

  return (
    <div className="app">
      <header>
        <h1>{title}</h1>
        {tab === 'tracks' && (
          <button className="add" onClick={() => fileInput.current?.click()}>
            Добавить музыку
          </button>
        )}
        <input ref={fileInput} type="file" accept="audio/*" multiple hidden onChange={onPick} />
      </header>

      {status && <div className="status">{status}</div>}

      <main className="list">
        {tab === 'tracks' && (
          <>
            {tracks && tracks.length > 0 && (
              <div className="search-wrap">
                <input
                  className="search"
                  type="search"
                  placeholder="Поиск по названию и исполнителю"
                  aria-label="Поиск по библиотеке"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                />
              </div>
            )}
            {tracks && tracks.length === 0 && (
              <p className="empty">
                Здесь пока пусто. Добавьте аудиофайлы с устройства или подключите облако на вкладке «Облако».
              </p>
            )}
            {tracks && tracks.length > 0 && shown && shown.length === 0 && (
              <p className="empty">Ничего не найдено. Попробуйте другое слово.</p>
            )}
            {shown?.map((t, i) => renderTrack(t, i, shown))}
          </>
        )}

        {tab === 'playlists' && !openPl && (
          <>
            {playlists && playlists.length === 0 && (
              <p className="empty">Плейлистов пока нет. Нажмите «⋯» у трека и выберите «В новый плейлист».</p>
            )}
            <div className="grid">
              {playlists?.map((p) => (
                <button key={p.id} className="card" onClick={() => setOpenId(p.id)}>
                  <Cover track={byId.get(p.trackIds[0])} label={p.name} className="card-cover" />
                  <span className="t-title">{p.name}</span>
                  <span className="t-sub">
                    {p.remoteId != null ? 'Облако · ' : ''}Треков: {p.trackIds.length}
                  </span>
                </button>
              ))}
            </div>
          </>
        )}

        {tab === 'playlists' && openPl && (
          <>
            <div className="sub-bar">
              <button onClick={() => setOpenId(null)}>Назад</button>
              <button className="primary" disabled={!plTracks.length} onClick={() => playQueue(plTracks, 0)}>
                Играть
              </button>
              {needDownload && <button onClick={() => download(plTracks)}>Скачать для оффлайна</button>}
              <button className="danger" onClick={() => removePlaylist(openPl)}>
                Удалить плейлист
              </button>
            </div>
            {plTracks.length === 0 && <p className="empty">В плейлисте пока нет треков. Добавьте их из вкладки «Библиотека».</p>}
            {plTracks.map((t, i) => renderTrack(t, i, plTracks, openPl.id))}
          </>
        )}

        {tab === 'cloud' && <CloudTab onChanged={() => setConnected(!!cloud.getCloud())} />}
      </main>

      {cur && (
        <div className="mini">
          <div className="mini-prog" style={{ width: `${pct}%` }} />
          <button className="mini-open" onClick={() => setFull(true)} aria-label="Открыть плеер">
            <Cover track={cur} label={cur.title} className="thumb" />
            <span className="t-col">
              <span className="t-title">{cur.title}</span>
              <span className={'t-sub' + (error ? ' err' : '')}>{loading ? 'Загружаем…' : (error ?? cur.artist)}</span>
            </span>
          </button>
          <button className="mini-play" onClick={toggle} aria-label={playing ? 'Пауза' : 'Играть'}>
            <Icon d={playing ? P.pause : P.play} size={30} />
          </button>
        </div>
      )}

      <nav className="tabbar">
        <button className={tab === 'tracks' ? 'on' : ''} onClick={() => setTab('tracks')}>
          <Icon d={P.note} />
          <span>Библиотека</span>
        </button>
        <button
          className={tab === 'playlists' ? 'on' : ''}
          onClick={() => {
            setTab('playlists');
            setOpenId(null);
          }}
        >
          <Icon d={P.list} />
          <span>Плейлисты</span>
        </button>
        <button className={tab === 'cloud' ? 'on' : ''} onClick={() => setTab('cloud')}>
          <Icon d={P.cloud} />
          <span>Облако</span>
        </button>
      </nav>

      {full && cur && (
        <NowPlaying
          track={cur}
          playing={playing}
          current={current}
          duration={duration}
          onClose={() => setFull(false)}
          onToggle={toggle}
          onPrev={prev}
          onNext={next}
          onSeek={seek}
        />
      )}

      {menu && (
        <div className="scrim" onClick={() => setMenu(null)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-title">{menu.track.title}</div>
            {menu.playlistId != null && (
              <button onClick={() => removeFrom(menu.playlistId!, menu.track)}>Убрать из этого плейлиста</button>
            )}
            {compatible(menu.track).map((p) => (
              <button key={p.id} onClick={() => addTo(p, menu.track)}>
                В плейлист «{p.name}»
              </button>
            ))}
            <button onClick={() => addToNew(menu.track)}>В новый плейлист…</button>
            {menu.track.remoteId && !cached.has(menu.track.id) && (
              <button onClick={() => download([menu.track])}>Скачать для оффлайна</button>
            )}
            {menu.track.remoteId && cached.has(menu.track.id) && (
              <button onClick={() => dropFromDevice(menu.track)}>Убрать с устройства (останется в облаке)</button>
            )}
            <button className="danger" onClick={() => removeTrack(menu.track)}>
              {menu.track.remoteId ? 'Удалить из облака' : 'Удалить из библиотеки'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
