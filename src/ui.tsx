import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import type { Track } from './db';

export function fmt(s: number) {
  if (!isFinite(s) || s < 0) return '0:00';
  return `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
}

export const P = {
  prev: 'M6 6h2v12H6zM9.5 12 18 6v12z',
  next: 'M16 6h2v12h-2zM6 18V6l8.5 6z',
  play: 'M8 5v14l11-7z',
  pause: 'M6 5h4v14H6zM14 5h4v14h-4z',
  more: 'M12 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm0 6a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm0 6a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  chevron: 'M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6z',
  note: 'M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z',
  list: 'M15 6H3v2h12V6zm0 4H3v2h12v-2zM3 16h8v-2H3v2zM17 6v8.18c-.31-.11-.65-.18-1-.18-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3V8h3V6h-5z'
};

export const Icon = ({ d, size = 24 }: { d: string; size?: number }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true">
    <path d={d} />
  </svg>
);

/** Обложка трека или заглушка с первой буквой названия. */
export function Cover({ track, label, className = '' }: { track?: Track; label: string; className?: string }) {
  const [url, setUrl] = useState<string>();
  const has = !!track?.cover;
  useEffect(() => {
    const blob = track?.cover;
    if (!blob) {
      setUrl(undefined);
      return;
    }
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [track?.id, has]);
  return url ? (
    <img className={`cover ${className}`} src={url} alt="" />
  ) : (
    <div className={`cover ph ${className}`} aria-hidden="true">
      {label.slice(0, 1).toUpperCase()}
    </div>
  );
}

function placeholderPeaks(id: number) {
  return Array.from({ length: 96 }, (_, i) =>
    Math.max(12, 38 + Math.round(20 * Math.sin(i * 0.45 + id) + 12 * Math.sin(i * 1.3 + id * 2)))
  );
}

/** Волна-прогресс: нажмите или проведите пальцем, чтобы перемотать. */
export function Wave({ peaks, id, progress, onSeek }: { peaks?: number[]; id: number; progress: number; onSeek: (ratio: number) => void }) {
  const bars = peaks ?? placeholderPeaks(id);
  const ref = useRef<HTMLDivElement>(null);
  const seekFrom = (e: PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    onSeek(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)));
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowRight') onSeek(Math.min(1, progress + 0.02));
    if (e.key === 'ArrowLeft') onSeek(Math.max(0, progress - 0.02));
  };
  return (
    <div
      ref={ref}
      className={'wave' + (peaks ? '' : ' dim')}
      role="slider"
      tabIndex={0}
      aria-label="Позиция в треке"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(progress * 100)}
      onKeyDown={onKey}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        seekFrom(e);
      }}
      onPointerMove={(e) => {
        if (e.buttons) seekFrom(e);
      }}
    >
      {bars.map((h, i) => (
        <span key={i} className={i / bars.length < progress ? 'on' : ''} style={{ height: `${h}%` }} />
      ))}
    </div>
  );
}
