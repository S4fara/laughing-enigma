import { parseBlob } from 'music-metadata';
import { db } from './db';

/** Уменьшает обложку до 400px и сжимает в JPEG, чтобы список оставался лёгким. */
export async function makeThumb(data: Uint8Array, type: string): Promise<Blob | undefined> {
  try {
    const bmp = await createImageBitmap(new Blob([data as unknown as BlobPart], { type }));
    const scale = Math.min(1, 400 / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * scale);
    const h = Math.round(bmp.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, w, h);
    return await new Promise((res) => canvas.toBlob((b) => res(b ?? undefined), 'image/jpeg', 0.82));
  } catch {
    return undefined;
  }
}

/** Достаёт обложку из скачанного файла трека. */
export async function coverFor(id: number) {
  let cover: Blob | undefined;
  try {
    const f = await db.files.get(id);
    const pic = f ? (await parseBlob(f.blob)).common.picture?.[0] : undefined;
    if (pic) cover = await makeThumb(pic.data, pic.format);
  } catch {
    // нет тегов — остаётся заглушка
  }
  await db.tracks.update(id, { cover, coverTried: true });
}

let backfilled = false;
/** Один раз достаёт обложки для треков, у которых уже есть файл на устройстве. */
export async function backfillCovers() {
  if (backfilled) return;
  backfilled = true;
  const todo = await db.tracks.filter((t) => !t.coverTried).toArray();
  for (const t of todo) {
    if (await db.files.get(t.id)) await coverFor(t.id);
  }
}

const busy = new Set<number>();
/** Считает «волну» трека (96 столбиков). Декодируем офлайн-контекстом, чтобы не трогать звук iOS. */
export async function computePeaks(id: number, bars = 96) {
  if (busy.has(id)) return;
  busy.add(id);
  try {
    const f = await db.files.get(id);
    if (!f) return; // файла ещё нет (трек из облака не скачан)
    if (f.blob.size > 30 * 1024 * 1024) throw new Error('skip');
    type Ctor = typeof OfflineAudioContext;
    const C: Ctor =
      window.OfflineAudioContext ||
      (window as unknown as { webkitOfflineAudioContext: Ctor }).webkitOfflineAudioContext;
    const buf = await new C(1, 1, 22050).decodeAudioData(await f.blob.arrayBuffer());
    const ch = buf.getChannelData(0);
    const step = Math.max(1, Math.floor(ch.length / bars));
    const raw: number[] = [];
    for (let i = 0; i < bars; i++) {
      let m = 0;
      for (let j = i * step; j < (i + 1) * step && j < ch.length; j += 16) {
        const v = Math.abs(ch[j]);
        if (v > m) m = v;
      }
      raw.push(m);
    }
    const max = Math.max(...raw) || 1;
    const peaks = raw.map((v) => Math.max(8, Math.round((v / max) * 100)));
    await db.tracks.update(id, { peaks, peaksTried: true });
  } catch {
    await db.tracks.update(id, { peaksTried: true });
  } finally {
    busy.delete(id);
  }
}
