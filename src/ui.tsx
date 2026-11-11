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
  shuffle: 'M10.59 9.17 5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z',
  repeat: 'M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z',
  volume: 'M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z',
  cloud: 'M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96z',
  chevronLeft: 'M15.41 16.59 10.83 12l4.58-4.59L14 6l-6 6 6 6 1.41-1.41z',
  chevronUp: 'M7.41 15.41 12 10.83l4.59 4.58L18 14l-6-6-6 6z',
  chevronRight: 'M8.59 16.59 13.17 12 8.59 7.41 10 6l6 6-6 6z',
  plus: 'M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z',
  home: 'M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z',
  search: 'M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z',
  library: 'M20 2H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-2 5h-3v5.5c0 1.38-1.12 2.5-2.5 2.5S10 13.88 10 12.5s1.12-2.5 2.5-2.5c.57 0 1.08.19 1.5.51V5h4v2zM4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6z',
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

/** true, пока выполняется media query (например, ширина окна от 1000px). */
export function useMedia(query: string) {
  const [match, setMatch] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const h = () => setMatch(mq.matches);
    mq.addEventListener('change', h);
    h();
    return () => mq.removeEventListener('change', h);
  }, [query]);
  return match;
}
