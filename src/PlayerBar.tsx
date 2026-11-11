import type { CSSProperties } from 'react';
import type { Track } from './db';
import { usePlayer } from './player';
import { Cover, Icon, P, fmt } from './ui';

/** Нижняя панель плеера для компьютера. */
export default function PlayerBar({ track, onOpen }: { track: Track; onOpen: () => void }) {
  const { playing, current, duration, loading, error, shuffle, repeat, volume, volumeSupported, toggle, next, prev, seek, toggleShuffle, cycleRepeat, setVolume } =
    usePlayer();
  const pct = duration > 0 ? (current / duration) * 100 : 0;
  const repeatLabel = repeat === 'off' ? 'Повтор выключен' : repeat === 'all' ? 'Повторять все треки' : 'Повторять один трек';

  return (
    <footer className="pbar">
      <input
        className="pbar-seek"
        type="range"
        min={0}
        max={duration || 0}
        step={0.1}
        value={current}
        onChange={(e) => seek(Number(e.target.value))}
        style={{ '--p': `${pct}%` } as CSSProperties}
        aria-label="Позиция в треке"
      />

      <div className="pb-left">
        <button onClick={prev} aria-label="Предыдущий трек">
          <Icon d={P.prev} size={28} />
        </button>
        <button className="play" onClick={toggle} aria-label={playing ? 'Пауза' : 'Играть'}>
          <Icon d={playing ? P.pause : P.play} size={40} />
        </button>
        <button onClick={next} aria-label="Следующий трек">
          <Icon d={P.next} size={28} />
        </button>
        <span className="pb-time">
          {fmt(current)} / {fmt(duration)}
        </span>
      </div>

      <button className="pb-info" onClick={onOpen} aria-label="Открыть большой плеер">
        <Cover track={track} label={track.title} className="thumb" />
        <span className="t-col">
          <span className="t-title">{track.title}</span>
          <span className={'t-sub' + (error ? ' err' : '')}>{loading ? 'Загружаем…' : (error ?? track.artist)}</span>
        </span>
      </button>

      <div className="pb-right">
        {volumeSupported && (
          <label className="pb-vol">
            <Icon d={P.volume} size={22} />
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={volume}
              onChange={(e) => setVolume(Number(e.target.value))}
              style={{ '--p': `${volume * 100}%` } as CSSProperties}
              aria-label="Громкость"
            />
          </label>
        )}
        <button className={repeat !== 'off' ? 'on' : ''} onClick={cycleRepeat} aria-label={repeatLabel}>
          <Icon d={P.repeat} />
          {repeat === 'one' && <span className="badge">1</span>}
        </button>
        <button className={shuffle ? 'on' : ''} onClick={toggleShuffle} aria-pressed={shuffle} aria-label="Перемешивание">
          <Icon d={P.shuffle} />
        </button>
        <button onClick={onOpen} aria-label="Развернуть плеер">
          <Icon d={P.chevronUp} size={28} />
        </button>
      </div>
    </footer>
  );
}
