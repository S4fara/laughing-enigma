import { useRef, useState, type ReactNode, type UIEvent } from 'react';
import type { Playlist, Track } from './db';
import { Cover, Icon, P } from './ui';

type Chip = 'all' | 'cached' | 'cloud' | 'local';
const CHIPS: [Chip, string][] = [
  ['all', 'Все'],
  ['cached', 'Оффлайн'],
  ['cloud', 'Облако'],
  ['local', 'С устройства']
];

interface Props {
  tracks: Track[];
  playlists: Playlist[];
  byId: Map<number, Track>;
  cached: Set<number>;
  nowId?: number;
  desktop: boolean;
  onPlay: (list: Track[], index: number) => void;
  onOpenPlaylist: (id: number) => void;
  onSeeAll: () => void;
  onAdd: () => void;
  onCloud: () => void;
}

/** Ряд с прокруткой и стрелками (версия для компьютера). */
function Carousel(props: { title: string; label?: string; action?: string; onAction?: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const by = (dir: number) => {
    const el = ref.current;
    if (!el) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: reduce ? 'auto' : 'smooth' });
  };
  return (
    <section>
      <div className="sec-head">
        <div>
          {props.label && <small className="sec-label">{props.label}</small>}
          <h2>{props.title}</h2>
        </div>
        <div className="sec-actions">
          {props.action && (
            <button className="see-all" onClick={props.onAction}>
              {props.action}
            </button>
          )}
          <button className="arrow" aria-label="Прокрутить назад" onClick={() => by(-1)}>
            <Icon d={P.chevronLeft} />
          </button>
          <button className="arrow" aria-label="Прокрутить вперёд" onClick={() => by(1)}>
            <Icon d={P.chevronRight} />
          </button>
        </div>
      </div>
      <div className="row-scroll" ref={ref}>
        {props.children}
      </div>
    </section>
  );
}

export default function Home(p: Props) {
  const [chip, setChip] = useState<Chip>('all');
  const [page, setPage] = useState(0);

  const pool = p.tracks.filter((t) =>
    chip === 'all' ? true : chip === 'cached' ? p.cached.has(t.id) : chip === 'cloud' ? !!t.remoteId : !t.remoteId
  );
  const quick = [...pool]
    .sort((a, b) => (b.lastPlayedAt ?? 0) - (a.lastPlayedAt ?? 0) || b.addedAt - a.addedAt)
    .slice(0, 27);
  const pages: Track[][] = [];
  for (let i = 0; i < quick.length; i += 9) pages.push(quick.slice(i, i + 9));
  const recent = [...pool].sort((a, b) => b.addedAt - a.addedAt).slice(0, 20);

  const onScroll = (e: UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    setPage(Math.round(el.scrollLeft / (el.clientWidth || 1)));
  };

  const card = (t: Track, i: number, list: Track[]) => (
    <button key={t.id} className="mcard big" onClick={() => p.onPlay(list, i)}>
      <span className="cw">
        <Cover track={t} label={t.title} />
        <span className="play-ov">
          <Icon d={P.play} size={48} />
        </span>
      </span>
      <span className="t-title">{t.title}</span>
      <span className="t-sub">{t.artist}</span>
    </button>
  );

  const chips = (
    <div className="chips">
      {CHIPS.map(([id, label]) => (
        <button key={id} className={'chip' + (chip === id ? ' on' : '')} onClick={() => setChip(id)}>
          {label}
        </button>
      ))}
    </div>
  );

  const hero = (
    <div className="hero">
      <h2>Здесь появится ваша музыка</h2>
      <p>Добавьте файлы с устройства или подключите облако на Telegram-боте.</p>
      <div className="hero-btns">
        <button className="add" onClick={p.onAdd}>
          Добавить музыку
        </button>
        <button className="ghost" onClick={p.onCloud}>
          Подключить облако
        </button>
      </div>
    </div>
  );

  // ---------- компьютер ----------
  if (p.desktop) {
    return (
      <div className="home">
        {p.tracks.length === 0 ? (
          hero
        ) : (
          <>
            {chips}
            {pool.length === 0 && <p className="empty">В этом разделе пока нет треков.</p>}
            {quick.length > 0 && (
              <Carousel title="Послушать ещё раз" label="Недавно слушали" action="Ещё" onAction={p.onSeeAll}>
                {quick.map((t, i) => card(t, i, quick))}
              </Carousel>
            )}
            {recent.length > 0 && (
              <Carousel title="Недавно добавлено" action="Смотреть все" onAction={p.onSeeAll}>
                {recent.map((t, i) => card(t, i, recent))}
              </Carousel>
            )}
            {p.playlists.length > 0 && (
              <Carousel title="Плейлисты">
                {p.playlists.map((pl) => (
                  <button key={pl.id} className="mcard big" onClick={() => p.onOpenPlaylist(pl.id)}>
                    <span className="cw">
                      <Cover track={p.byId.get(pl.trackIds[0])} label={pl.name} />
                    </span>
                    <span className="t-title">{pl.name}</span>
                    <span className="t-sub">Треков: {pl.trackIds.length}</span>
                  </button>
                ))}
              </Carousel>
            )}
          </>
        )}
      </div>
    );
  }

  // ---------- телефон ----------
  return (
    <div className="home">
      <div className="home-top">
        <div className="brand">
          <span className="logo">
            <Icon d={P.play} size={20} />
          </span>
          <span>Плеер</span>
        </div>
        <button className="round" onClick={p.onAdd} aria-label="Добавить музыку">
          <Icon d={P.plus} />
        </button>
      </div>

      {p.tracks.length === 0 ? (
        hero
      ) : (
        <>
          {chips}
          {pool.length === 0 && <p className="empty">В этом разделе пока нет треков.</p>}

          {pages.length > 0 && (
            <section>
              <button className="qp-head" onClick={p.onSeeAll}>
                <span>
                  <small>Недавно слушали</small>
                  <strong>Быстрый выбор</strong>
                </span>
                <Icon d={P.chevronRight} size={32} />
              </button>
              <div className="qp-pages" onScroll={onScroll}>
                {pages.map((pg, pi) => (
                  <div className="qp-page" key={pi}>
                    {pg.map((t, i) => (
                      <button
                        key={t.id}
                        className={'tile' + (p.nowId === t.id ? ' active' : '')}
                        onClick={() => p.onPlay(quick, pi * 9 + i)}
                        aria-label={`${t.title}, ${t.artist}`}
                      >
                        <Cover track={t} label={t.title} />
                        <span className="tile-title">{t.title}</span>
                      </button>
                    ))}
                  </div>
                ))}
              </div>
              {pages.length > 1 && (
                <div className="dots" aria-hidden="true">
                  {pages.map((_, i) => (
                    <span key={i} className={i === page ? 'on' : ''} />
                  ))}
                </div>
              )}
            </section>
          )}

          {recent.length > 0 && (
            <section>
              <div className="sec-head">
                <h2>Недавно добавлено</h2>
                <button className="see-all" onClick={p.onSeeAll}>
                  Смотреть все
                </button>
              </div>
              <div className="row-scroll">
                {recent.map((t, i) => (
                  <button key={t.id} className="mcard" onClick={() => p.onPlay(recent, i)}>
                    <Cover track={t} label={t.title} />
                    <span className="t-title">{t.title}</span>
                    <span className="t-sub">{t.artist}</span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {p.playlists.length > 0 && (
            <section>
              <div className="sec-head">
                <h2>Плейлисты</h2>
              </div>
              <div className="row-scroll">
                {p.playlists.map((pl) => (
                  <button key={pl.id} className="mcard" onClick={() => p.onOpenPlaylist(pl.id)}>
                    <Cover track={p.byId.get(pl.trackIds[0])} label={pl.name} />
                    <span className="t-title">{pl.name}</span>
                    <span className="t-sub">Треков: {pl.trackIds.length}</span>
                  </button>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
