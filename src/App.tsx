import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, deleteTrack, type Playlist, type Track } from './db';
import { importFiles } from './import';
import { backfillCovers, computePeaks } from './meta';
import { usePlayer } from './player';
import NowPlaying from './NowPlaying';
import { Cover, Icon, P, fmt } from './ui';

type Menu = { track: Track; playlistId?: number } | null;

export default function App() {
  const tracks = useLiveQuery(() => db.tracks.orderBy('addedAt').reverse().toArray(), []);
  const playlists = useLiveQuery(() => db.playlists.orderBy('createdAt').toArray(), []);
  const [tab, setTab] = useState<'tracks' | 'playlists'>('tracks');
  const [openId, setOpenId] = useState<number | null>(null);
  const [menu, setMenu] = useState<Menu>(null);
  const [full, setFull] = useState(false);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const { queue, index, playing, current, duration, playQueue, toggle, next, prev, seek } = usePlayer();
  const now = queue[index];
  const cur = useLiveQuery(() => (now ? db.tracks.get(now.id) : undefined), [now?.id]) ?? now;

  useEffect(() => {
    void backfillCovers();
  }, []);
  useEffect(() => {
    if (cur && !cur.peaks && !cur.peaksTried) void computePeaks(cur.id);
  }, [cur?.id, !!cur?.peaks, !!cur?.peaksTried]);

  const needle = q.trim().toLowerCase();
  const shown =
    tracks && needle
      ? tracks.filter((t) => `${t.title} ${t.artist} ${t.album}`.toLowerCase().includes(needle))
      : tracks;

  const byId = new Map((tracks ?? []).map((t) => [t.id, t]));
  const openPl = playlists?.find((p) => p.id === openId);
  const plTracks = openPl ? openPl.trackIds.map((id) => byId.get(id)).filter((t): t is Track => !!t) : [];

  async function onPick(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (!files.length) return;
    await importFiles(files, (done, total) => setStatus(`Добавляем ${done} из ${total}…`));
    setStatus('');
  }
  async function addTo(pid: number, tid: number) {
    await db.playlists.where('id').equals(pid).modify((p) => {
      if (!p.trackIds.includes(tid)) p.trackIds.push(tid);
    });
    setMenu(null);
  }
  async function addToNew(tid: number) {
    const name = window.prompt('Название плейлиста')?.trim();
    if (!name) return;
    await db.playlists.add({ name, trackIds: [tid], createdAt: Date.now() });
    setMenu(null);
  }
  async function removeFrom(pid: number, tid: number) {
    await db.playlists.where('id').equals(pid).modify((p) => {
      p.trackIds = p.trackIds.filter((x) => x !== tid);
    });
    setMenu(null);
  }
  async function removeTrack(t: Track) {
    if (!window.confirm(`Удалить «${t.title}» из библиотеки?`)) return;
    await deleteTrack(t.id);
    setMenu(null);
  }
  async function removePlaylist(p: Playlist) {
    if (!window.confirm(`Удалить плейлист «${p.name}»? Треки останутся в библиотеке.`)) return;
    await db.playlists.delete(p.id);
    setOpenId(null);
  }

  function renderTrack(t: Track, i: number, list: Track[], playlistId?: number) {
    return (
      <div key={t.id} className={'item' + (now?.id === t.id ? ' active' : '')}>
        <button className="track" onClick={() => playQueue(list, i)}>
          <Cover track={t} label={t.title} className="thumb" />
          <span className="t-col">
            <span className="t-title">{t.title}</span>
            <span className="t-sub">{t.artist}</span>
          </span>
        </button>
        <span className="dur">{fmt(t.duration)}</span>
        <button className="more" aria-label="Действия с треком" onClick={() => setMenu({ track: t, playlistId })}>
          <Icon d={P.more} />
        </button>
      </div>
    );
  }

  const pct = duration > 0 ? (current / duration) * 100 : 0;
  const title = tab === 'tracks' ? 'Библиотека' : openPl ? openPl.name : 'Плейлисты';

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
              <p className="empty">Здесь пока пусто. Добавьте аудиофайлы с телефона или компьютера, и они появятся тут.</p>
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
                  <span className="t-sub">Треков: {p.trackIds.length}</span>
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
              <button className="danger" onClick={() => removePlaylist(openPl)}>
                Удалить плейлист
              </button>
            </div>
            {plTracks.length === 0 && <p className="empty">В плейлисте пока нет треков. Добавьте их из вкладки «Библиотека».</p>}
            {plTracks.map((t, i) => renderTrack(t, i, plTracks, openPl.id))}
          </>
        )}
      </main>

      {cur && (
        <div className="mini">
          <div className="mini-prog" style={{ width: `${pct}%` }} />
          <button className="mini-open" onClick={() => setFull(true)} aria-label="Открыть плеер">
            <Cover track={cur} label={cur.title} className="thumb" />
            <span className="t-col">
              <span className="t-title">{cur.title}</span>
              <span className="t-sub">{cur.artist}</span>
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
              <button onClick={() => removeFrom(menu.playlistId!, menu.track.id)}>Убрать из этого плейлиста</button>
            )}
            {playlists?.map((p) => (
              <button key={p.id} onClick={() => addTo(p.id, menu.track.id)}>
                В плейлист «{p.name}»
              </button>
            ))}
            <button onClick={() => addToNew(menu.track.id)}>В новый плейлист…</button>
            <button className="danger" onClick={() => removeTrack(menu.track)}>
              Удалить из библиотеки
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
