import { useRef, useState, type ChangeEvent, type CSSProperties } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './db';
import { importFiles } from './import';
import { usePlayer } from './player';

function fmt(s: number) {
  if (!isFinite(s) || s < 0) return '0:00';
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${r.toString().padStart(2, '0')}`;
}

const Icon = ({ d }: { d: string }) => (
  <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true">
    <path d={d} />
  </svg>
);
const PREV = 'M6 6h2v12H6zM9.5 12 18 6v12z';
const NEXT = 'M16 6h2v12h-2zM6 18V6l8.5 6z';
const PLAY = 'M8 5v14l11-7z';
const PAUSE = 'M6 5h4v14H6zM14 5h4v14h-4z';

export default function App() {
  const tracks = useLiveQuery(() => db.tracks.orderBy('addedAt').reverse().toArray(), []);
  const [status, setStatus] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const { queue, index, playing, current, duration, playQueue, toggle, next, prev, seek } =
    usePlayer();
  const now = queue[index];

  async function onPick(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (!files.length) return;
    await importFiles(files, (done, total) => setStatus(`Добавляем ${done} из ${total}…`));
    setStatus('');
  }

  const pct = duration > 0 ? (current / duration) * 100 : 0;

  return (
    <div className="app">
      <header>
        <h1>Библиотека</h1>
        <button className="add" onClick={() => fileInput.current?.click()}>
          Добавить музыку
        </button>
        <input ref={fileInput} type="file" accept="audio/*" multiple hidden onChange={onPick} />
      </header>

      {status && <div className="status">{status}</div>}

      <main className="list">
        {tracks && tracks.length === 0 && (
          <p className="empty">
            Здесь пока пусто. Добавьте аудиофайлы с телефона или компьютера, и они появятся тут.
          </p>
        )}
        {tracks?.map((t, i) => (
          <button
            key={t.id}
            className={'track' + (now?.id === t.id ? ' active' : '')}
            onClick={() => playQueue(tracks, i)}
          >
            <span className="t-title">{t.title}</span>
            <span className="t-sub">{t.artist}</span>
          </button>
        ))}
      </main>

      {now && (
        <footer className="bar">
          <input
            type="range"
            min={0}
            max={duration || 0}
            step={0.1}
            value={current}
            onChange={(e) => seek(Number(e.target.value))}
            style={{ '--p': `${pct}%` } as CSSProperties}
            aria-label="Позиция в треке"
          />
          <div className="times">
            <span>{fmt(current)}</span>
            <span>{fmt(duration)}</span>
          </div>
          <div className="row">
            <div className="info">
              <span className="t-title">{now.title}</span>
              <span className="t-sub">{now.artist}</span>
            </div>
            <div className="ctl">
              <button onClick={prev} aria-label="Предыдущий трек">
                <Icon d={PREV} />
              </button>
              <button className="play" onClick={toggle} aria-label={playing ? 'Пауза' : 'Играть'}>
                <Icon d={playing ? PAUSE : PLAY} />
              </button>
              <button onClick={next} aria-label="Следующий трек">
                <Icon d={NEXT} />
              </button>
            </div>
          </div>
        </footer>
      )}
    </div>
  );
}
