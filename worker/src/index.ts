export interface Env {
  DB: D1Database;
  BOT_TOKEN: string;
  APP_TOKEN: string;
  WEBHOOK_SECRET: string;
  OWNER_ID: string;
  ALLOWED_ORIGIN: string;
}

const MAX_BYTES = 20 * 1024 * 1024; // лимит Telegram на выдачу файлов ботом
const AUDIO_EXT = /\.(mp3|m4a|aac|flac|ogg|opus|wav)$/i;

const HELP = `Пришлите мне аудиофайлы, и они появятся в вашем плеере.

Плейлисты:
• подпись к файлу #Название добавит трек в плейлист (пробелы заменяйте на _, например #Моя_дорога)
• /playlist Название: все следующие треки пойдут в этот плейлист
• /playlist off: выключить
• /playlists: список плейлистов
• /stats: сколько треков в библиотеке

Файлы больше 20 МБ бот отдать плееру не сможет.`;

// ---------- утилиты ----------

const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers }
  });

function safeEq(a: string, b: string): boolean {
  const A = new TextEncoder().encode(a);
  const B = new TextEncoder().encode(b);
  if (A.length !== B.length || A.length === 0) return false;
  return crypto.subtle.timingSafeEqual(A, B);
}

function cors(env: Env, req: Request): Record<string, string> {
  const origin = req.headers.get('origin') ?? '';
  const allowed = env.ALLOWED_ORIGIN.split(',').map((s) => s.trim());
  return {
    ...(allowed.includes(origin) ? { 'access-control-allow-origin': origin } : {}),
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
    'access-control-expose-headers': 'content-length',
    'access-control-max-age': '86400',
    vary: 'origin'
  };
}

const tg = (env: Env, method: string, body: unknown = {}) =>
  fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });

const send = (env: Env, chat: number, text: string) => tg(env, 'sendMessage', { chat_id: chat, text });

// ---------- плейлисты и состояние ----------

async function getState(env: Env, key: string): Promise<string> {
  const row = await env.DB.prepare('SELECT value FROM state WHERE key = ?').bind(key).first<{ value: string }>();
  return row?.value ?? '';
}
async function setState(env: Env, key: string, value: string) {
  await env.DB.prepare('INSERT INTO state (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = ?2')
    .bind(key, value)
    .run();
}

async function ensurePlaylist(env: Env, name: string): Promise<number> {
  const rows = await env.DB.prepare('SELECT id, name FROM playlists WHERE deleted = 0').all<{ id: number; name: string }>();
  const hit = rows.results.find((p) => p.name.toLowerCase() === name.toLowerCase());
  if (hit) return hit.id;
  const r = await env.DB.prepare('INSERT INTO playlists (name, created_at) VALUES (?, ?)').bind(name, Date.now()).run();
  return r.meta.last_row_id as number;
}

async function addToPlaylist(env: Env, playlistId: number, trackId: string) {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id, pos)
     VALUES (?1, ?2, (SELECT COALESCE(MAX(pos), -1) + 1 FROM playlist_tracks WHERE playlist_id = ?1))`
  )
    .bind(playlistId, trackId)
    .run();
}

// ---------- Telegram ----------

async function telegram(req: Request, env: Env): Promise<Response> {
  if (!safeEq(req.headers.get('x-telegram-bot-api-secret-token') ?? '', env.WEBHOOK_SECRET)) {
    return new Response('forbidden', { status: 403 });
  }
  try {
    const update = (await req.json()) as { message?: any };
    if (update.message) await handleMessage(update.message, env);
  } catch (e) {
    console.error(e); // всегда отвечаем 200, чтобы Telegram не повторял запрос
  }
  return new Response('ok');
}

async function handleMessage(msg: any, env: Env) {
  const chat: number = msg.chat.id;
  const from = msg.from?.id;
  if (!env.OWNER_ID || String(from) !== String(env.OWNER_ID)) {
    await send(env, chat, `Это личный бот. Ваш Telegram ID: ${from}. Если бот ваш, сохраните этот номер как секрет OWNER_ID (см. инструкцию).`);
    return;
  }
  if (typeof msg.text === 'string' && msg.text.startsWith('/')) return command(env, chat, msg.text);

  const a =
    msg.audio ??
    (msg.document && (msg.document.mime_type?.startsWith('audio/') || AUDIO_EXT.test(msg.document.file_name ?? ''))
      ? msg.document
      : null);
  if (!a) {
    await send(env, chat, 'Пришлите аудиофайл (mp3, m4a, flac…) или команду /help');
    return;
  }
  await addTrack(env, msg, a);
}

async function command(env: Env, chat: number, text: string) {
  const [raw, ...rest] = text.trim().split(/\s+/);
  const cmd = raw.split('@')[0].toLowerCase();
  const arg = rest.join(' ').trim();

  if (cmd === '/playlist') {
    if (!arg) {
      const id = Number(await getState(env, 'active_playlist'));
      const row = id ? await env.DB.prepare('SELECT name FROM playlists WHERE id = ? AND deleted = 0').bind(id).first<{ name: string }>() : null;
      await send(env, chat, row ? `Сейчас новые треки идут в плейлист «${row.name}». Отключить: /playlist off` : 'Активного плейлиста нет. Выбрать: /playlist Название');
      return;
    }
    if (arg.toLowerCase() === 'off') {
      await setState(env, 'active_playlist', '');
      await send(env, chat, 'Готово: новые треки больше не попадают в плейлист автоматически.');
      return;
    }
    const id = await ensurePlaylist(env, arg);
    await setState(env, 'active_playlist', String(id));
    await send(env, chat, `Теперь новые треки идут в плейлист «${arg}». Выключить: /playlist off`);
    return;
  }
  if (cmd === '/playlists') {
    const rows = await env.DB.prepare(
      `SELECT p.name, COUNT(t.id) AS n FROM playlists p
       LEFT JOIN playlist_tracks pt ON pt.playlist_id = p.id
       LEFT JOIN tracks t ON t.id = pt.track_id AND t.deleted = 0
       WHERE p.deleted = 0 GROUP BY p.id ORDER BY p.created_at`
    ).all<{ name: string; n: number }>();
    await send(env, chat, rows.results.length ? rows.results.map((r) => `• ${r.name}: ${r.n}`).join('\n') : 'Плейлистов пока нет.');
    return;
  }
  if (cmd === '/stats') {
    const r = await env.DB.prepare('SELECT COUNT(*) AS n FROM tracks WHERE deleted = 0').first<{ n: number }>();
    await send(env, chat, `Треков в библиотеке: ${r?.n ?? 0}`);
    return;
  }
  await send(env, chat, HELP);
}

function names(a: any): { title: string; artist: string } {
  const base = String(a.file_name ?? '').replace(/\.[^.]+$/, '');
  let title: string = a.title || base || 'Без названия';
  let artist: string = a.performer || '';
  if (!artist && !a.title && base.includes(' - ')) {
    const [x, ...y] = base.split(' - ');
    artist = x.trim();
    title = y.join(' - ').trim() || title;
  }
  return { title, artist: artist || 'Неизвестный исполнитель' };
}

async function addTrack(env: Env, msg: any, a: any) {
  const chat: number = msg.chat.id;
  const { title, artist } = names(a);

  if ((a.file_size ?? 0) > MAX_BYTES) {
    await send(env, chat, `«${title}» больше 20 МБ, бот не сможет отдать его плееру. Пришлите версию полегче.`);
    return;
  }

  const id: string = a.file_unique_id;
  const existing = await env.DB.prepare('SELECT deleted FROM tracks WHERE id = ?').bind(id).first<{ deleted: number }>();
  const isDuplicate = !!existing && !existing.deleted;

  if (!existing) {
    await env.DB.prepare(
      'INSERT INTO tracks (id, file_id, title, artist, duration, size, mime, added_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    )
      .bind(id, a.file_id, title, artist, a.duration ?? 0, a.file_size ?? 0, a.mime_type ?? null, Date.now())
      .run();
  } else if (existing.deleted) {
    await env.DB.prepare('UPDATE tracks SET deleted = 0, file_id = ?, added_at = ? WHERE id = ?').bind(a.file_id, Date.now(), id).run();
  }

  // плейлист: сначала #хештег в подписи, иначе активный плейлист
  let playlistId = 0;
  const tag = String(msg.caption ?? '').match(/#([\p{L}\p{N}_]+)/u);
  if (tag) {
    playlistId = await ensurePlaylist(env, tag[1].replace(/_/g, ' '));
  } else {
    const active = Number(await getState(env, 'active_playlist'));
    if (active) {
      const ok = await env.DB.prepare('SELECT id FROM playlists WHERE id = ? AND deleted = 0').bind(active).first();
      if (ok) playlistId = active;
    }
  }
  if (playlistId) await addToPlaylist(env, playlistId, id);

  if (isDuplicate) {
    await send(env, chat, `«${title}» уже есть в библиотеке${playlistId ? ', добавил в плейлист' : ''}.`);
  } else {
    await tg(env, 'setMessageReaction', {
      chat_id: chat,
      message_id: msg.message_id,
      reaction: [{ type: 'emoji', emoji: '👍' }]
    }).catch(() => {});
  }
}

// ---------- API для плеера ----------

async function api(req: Request, url: URL, env: Env, h: Record<string, string>): Promise<Response> {
  const [res, rawId, sub, rawSubId] = url.pathname.split('/').filter(Boolean).slice(1);
  const id = rawId ? decodeURIComponent(rawId) : '';
  const subId = rawSubId ? decodeURIComponent(rawSubId) : '';
  const m = req.method;

  if (res === 'ping') return json({ ok: true }, 200, h);

  if (res === 'library' && m === 'GET') {
    const tr = await env.DB.prepare(
      'SELECT id, title, artist, duration, size, added_at AS addedAt FROM tracks WHERE deleted = 0 ORDER BY added_at DESC'
    ).all();
    const pl = await env.DB.prepare('SELECT id, name, created_at AS createdAt FROM playlists WHERE deleted = 0 ORDER BY created_at').all<{
      id: number;
      name: string;
      createdAt: number;
    }>();
    const ln = await env.DB.prepare(
      `SELECT pt.playlist_id AS pid, pt.track_id AS tid FROM playlist_tracks pt
       JOIN tracks t ON t.id = pt.track_id WHERE t.deleted = 0 ORDER BY pt.playlist_id, pt.pos`
    ).all<{ pid: number; tid: string }>();
    const byPl = new Map<number, string[]>();
    for (const r of ln.results) {
      const arr = byPl.get(r.pid) ?? [];
      arr.push(r.tid);
      byPl.set(r.pid, arr);
    }
    return json({ tracks: tr.results, playlists: pl.results.map((p) => ({ ...p, trackIds: byPl.get(p.id) ?? [] })) }, 200, h);
  }

  if (res === 'file' && m === 'GET' && id) {
    const row = await env.DB.prepare('SELECT file_id, mime FROM tracks WHERE id = ? AND deleted = 0').bind(id).first<{ file_id: string; mime: string | null }>();
    if (!row) return json({ error: 'not found' }, 404, h);
    const g = (await (await tg(env, 'getFile', { file_id: row.file_id })).json()) as { ok: boolean; result?: { file_path: string }; description?: string };
    if (!g.ok || !g.result) return json({ error: 'telegram', detail: g.description }, 502, h);
    const f = await fetch(`https://api.telegram.org/file/bot${env.BOT_TOKEN}/${g.result.file_path}`);
    if (!f.ok) return json({ error: 'telegram file' }, 502, h);
    const len = f.headers.get('content-length');
    return new Response(f.body, {
      headers: {
        ...h,
        'content-type': row.mime || 'audio/mpeg',
        ...(len ? { 'content-length': len } : {}),
        'cache-control': 'private, max-age=86400'
      }
    });
  }

  if (res === 'tracks' && m === 'DELETE' && id) {
    await env.DB.batch([
      env.DB.prepare('UPDATE tracks SET deleted = 1 WHERE id = ?').bind(id),
      env.DB.prepare('DELETE FROM playlist_tracks WHERE track_id = ?').bind(id)
    ]);
    return json({ ok: true }, 200, h);
  }

  if (res === 'playlists') {
    if (m === 'POST' && !id) {
      const { name } = (await req.json()) as { name?: string };
      const n = (name ?? '').trim();
      if (!n) return json({ error: 'name required' }, 400, h);
      return json({ id: await ensurePlaylist(env, n) }, 200, h);
    }
    if (m === 'DELETE' && id && !sub) {
      await env.DB.batch([
        env.DB.prepare('UPDATE playlists SET deleted = 1 WHERE id = ?').bind(Number(id)),
        env.DB.prepare('DELETE FROM playlist_tracks WHERE playlist_id = ?').bind(Number(id))
      ]);
      return json({ ok: true }, 200, h);
    }
    if (m === 'POST' && id && sub === 'tracks') {
      const { trackId } = (await req.json()) as { trackId?: string };
      if (!trackId) return json({ error: 'trackId required' }, 400, h);
      await addToPlaylist(env, Number(id), trackId);
      return json({ ok: true }, 200, h);
    }
    if (m === 'DELETE' && id && sub === 'tracks' && subId) {
      await env.DB.prepare('DELETE FROM playlist_tracks WHERE playlist_id = ? AND track_id = ?').bind(Number(id), subId).run();
      return json({ ok: true }, 200, h);
    }
  }

  return json({ error: 'not found' }, 404, h);
}

// ---------- вход ----------

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const h = cors(env, req);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: h });

    try {
      if (url.pathname === '/telegram' && req.method === 'POST') return await telegram(req, env);

      if (url.pathname === '/setup') {
        if (!safeEq(url.searchParams.get('token') ?? '', env.APP_TOKEN)) {
          return new Response('Откройте адрес вида /setup?token=ВАШ_APP_TOKEN', { status: 401 });
        }
        const r = await tg(env, 'setWebhook', {
          url: `${url.origin}/telegram`,
          secret_token: env.WEBHOOK_SECRET,
          allowed_updates: ['message']
        });
        return new Response(await r.text(), { headers: { 'content-type': 'application/json' } });
      }

      if (url.pathname.startsWith('/api/')) {
        if (!safeEq((req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, ''), env.APP_TOKEN)) {
          return json({ error: 'unauthorized' }, 401, h);
        }
        return await api(req, url, env, h);
      }
      return new Response('player-bot работает');
    } catch (e) {
      console.error(e);
      return json({ error: 'server error' }, 500, h);
    }
  }
};
