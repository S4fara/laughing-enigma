import { useEffect, type CSSProperties } from 'react';
import type { Track } from './db';
import { usePlayer } from './player';
import { Cover, Icon, P, Wave, fmt } from './ui';

interface Props {
  track: Track;
  playing: boolean;
  current: number;
  duration: number;
  onClose: () => void;
  onToggle: () => void;
  onPrev: () => void;
  onNext: () => void;
  onSeek: (t: number) => void;
}

const REPEAT_LABEL = { off: 'Повтор выключен', all: 'Повторять все треки', one: 'Повторять один трек' };

export default function NowPlaying(p: Props) {
  const progress = p.duration > 0 ? p.current / p.duration : 0;
  const { onClose } = p;
  const { shuffle, repeat, volume, volumeSupported, toggleShuffle, cycleRepeat, setVolume } = usePlayer();

  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  return (
    <div className="np" role="dialog" aria-label="Сейчас играет">
      <Cover track={p.track} label={p.track.title} className="np-bg" />
      <div className="np-top">
        <button onClick={p.onClose} aria-label="Свернуть плеер">
          <Icon d={P.chevron} size={32} />
        </button>
      </div>
      <Cover track={p.track} label={p.track.title} className="np-cover" />
      <div className="np-meta">
        <h2>{p.track.title}</h2>
        <p>{p.track.artist}</p>
      </div>
      <Wave peaks={p.track.peaks} id={p.track.id} progress={progress} onSeek={(r) => p.onSeek(r * p.duration)} />
      <div className="times">
        <span>{fmt(p.current)}</span>
        <span>{fmt(p.duration)}</span>
      </div>
      <div className="np-ctl">
        <button
          className={'side' + (shuffle ? ' on' : '')}
          onClick={toggleShuffle}
          aria-label={shuffle ? 'Перемешивание включено' : 'Перемешивание выключено'}
          aria-pressed={shuffle}
        >
          <Icon d={P.shuffle} />
        </button>
        <button onClick={p.onPrev} aria-label="Предыдущий трек">
          <Icon d={P.prev} size={32} />
        </button>
        <button className="play" onClick={p.onToggle} aria-label={p.playing ? 'Пауза' : 'Играть'}>
          <Icon d={p.playing ? P.pause : P.play} size={36} />
        </button>
        <button onClick={p.onNext} aria-label="Следующий трек">
          <Icon d={P.next} size={32} />
        </button>
        <button
          className={'side' + (repeat !== 'off' ? ' on' : '')}
          onClick={cycleRepeat}
          aria-label={REPEAT_LABEL[repeat]}
        >
          <Icon d={P.repeat} />
          {repeat === 'one' && <span className="badge">1</span>}
        </button>
      </div>
      {volumeSupported && (
        <div className="vol">
          <Icon d={P.volume} size={20} />
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
        </div>
      )}
    </div>
  );
}
