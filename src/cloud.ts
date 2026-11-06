import { db, type Track } from './db';
import { computePeaks, coverFor } from './meta';

const K = { url: 'cloud-url', token: 'cloud-token', sync: 'cloud-last-sync' };

function read(k: string): string | null {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function write(k: string, v: string | null) {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {
    // хранилище недоступно
  }
}

export function getCloud(): { url: string; token: string } | null {
  const url = read(K.url);
  const token = read(K.token);
  return url && token ? { url, token } : null;
}
export function lastSync(): number {
  return Number(read(K.sync)) || 0;
}
export function saveCloud(url: string, token: string) {
  let u = url.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  write(K.url, u);
  write(K.token, token.trim());
}
export function clearCredentials() {
  write(K.url, null);
  write(K.token, null);
}

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const c = getCloud();
  if (!c) throw new Error('Облако не подключено');
  let res: Response;
  try {
    res = await fetch(c.url + path, {
      ...init,
      headers: {
        ...(init.headers as Record<string, string> | undefined),
        authorization: `Bearer ${c.token}`,
        ...(init.body ? { 'content-type': 'application/json' } : {})
      }
    });
  } catch {
    throw new Error('Нет связи с сервером. Проверьте адрес и интернет.');
  }
  if (res.status === 401) throw new Error('Неверный токен');
  if (!res.ok) throw new Error(`Ошибка сервера (${res.status})`);
  return res;
}
const call = async <T>(path: string, init?: RequestInit) => (await request(path, init)).json() as Promise<T>;

export const ping = () => call<{ ok: boolean }>('/api/ping');
export const createPlaylist = async (name: string) =>
  (await call<{ id: number }>('/api/playlists', { method: 'POST', body: JSON.stringify({ name }) })).id;
export const addToPlaylist = (pid: number, trackId: string) =>
  call(`/api/playlists/${pid}/tracks`, { method: 'POST', body: JSON.stringify({ trackId }) });
export const removeFromPlaylist = (pid: number, trackId: string) =>
  call(`/api/playlists/${pid}/tracks/${encodeURIComponent(trackId)}`, { method: 'DELETE' });
export const deletePlaylist = (pid: number) => call(`/api/playlists/${pid}`, { method: 'DELETE' });
export const deleteRemoteTrack = (trackId: string) => call(`/api/tracks/${encodeURIComponent(trackId)}`, { method: 'DELETE' });

// ---------- синхронизация ----------

interface RemoteTrack {
  id: string;
  title: string;
  artist: string;
  duration: number;
  addedAt: number;
}
interface RemotePlaylist {
  id: number;
  name: string;
  createdAt: number;
  trackIds: string[];
}

let inflight: Promise<void> | null = null;
export function syncLibrary(): Promise<void> {
  if (!inflight) inflight = doSync().finally(() => (inflight = null));
  return inflight;
}
/** Не чаще раза в 15 секунд, чтобы не дёргать сервер при каждом переключении вкладок. */
export function syncIfStale(): Promise<void> {
  if (Date.now() - lastSync() < 15_000) return Promise.resolve();
  return syncLibrary();
}

async function doSync() {
  const lib = await call<{ tracks: RemoteTrack[]; playlists: RemotePlaylist[] }>('/api/library');
  const remoteIds = new Set(lib.tracks.map((t) => t.id));

  await db.transaction('rw', db.tracks, db.files, db.playlists, async () => {
    const local = await db.tracks.toArray();
    const idMap = new Map<string, number>(); // id в облаке -> локальный id

    for (const t of local) {
      if (!t.remoteId) continue;
      if (remoteIds.has(t.remoteId)) idMap.set(t.remoteId, t.id);
      else {
        await db.tracks.delete(t.id); // удалён в облаке
        await db.files.delete(t.id);
      }
    }
    for (const r of lib.tracks) {
      if (idMap.has(r.id)) continue;
      const id = await db.tracks.add({
        title: r.title,
        artist: r.artist,
        album: '',
        duration: r.duration,
        addedAt: r.addedAt,
        remoteId: r.id
      });
      idMap.set(r.id, id);
    }

    const localPls = await db.playlists.toArray();
    const seen = new Set<number>();
    for (const rp of lib.playlists) {
      seen.add(rp.id);
      const trackIds = rp.trackIds.map((t) => idMap.get(t)).filter((x): x is number => x != null);
      const ex = localPls.find((p) => p.remoteId === rp.id);
      if (ex) await db.playlists.update(ex.id, { name: rp.name, trackIds });
      else await db.playlists.add({ name: rp.name, trackIds, createdAt: rp.createdAt, remoteId: rp.id });
    }
    for (const p of localPls) {
      if (p.remoteId != null && !seen.has(p.remoteId)) await db.playlists.delete(p.id);
    }
  });
  write(K.sync, String(Date.now()));
}

/** Отключение: убираем с устройства всё, что пришло из облака. Локальные треки не трогаем. */
export async function disconnectCloud() {
  await db.transaction('rw', db.tracks, db.files, db.playlists, async () => {
    const remote = await db.tracks.filter((t) => !!t.remoteId).toArray();
    for (const t of remote) {
      await db.tracks.delete(t.id);
      await db.files.delete(t.id);
    }
    await db.playlists.filter((p) => p.remoteId != null).delete();
  });
  clearCredentials();
  write(K.sync, null);
}

// ---------- скачивание файлов для оффлайна ----------

const downloads = new Map<number, Promise<Blob>>();

/** Возвращает файл трека: из памяти устройства или скачивает из облака и сохраняет. */
export async function ensureFile(t: Track): Promise<Blob | undefined> {
  const existing = await db.files.get(t.id);
  if (existing) return existing.blob;
  if (!t.remoteId) return undefined;

  let job = downloads.get(t.id);
  if (!job) {
    job = (async () => {
      const res = await request(`/api/file/${encodeURIComponent(t.remoteId!)}`);
      const blob = await res.blob();
      await db.files.put({ id: t.id, blob });
      void coverFor(t.id);
      void computePeaks(t.id);
      return blob;
    })().finally(() => downloads.delete(t.id));
    downloads.set(t.id, job);
  }
  return job;
}
