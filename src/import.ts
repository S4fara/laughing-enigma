import { parseBlob } from 'music-metadata';
import { db } from './db';

export async function importFiles(
  files: File[],
  onProgress: (done: number, total: number) => void
) {
  let done = 0;
  for (const file of files) {
    let title = file.name.replace(/\.[^.]+$/, '');
    let artist = 'Неизвестный исполнитель';
    let album = '';
    let duration = 0;
    try {
      const meta = await parseBlob(file, { duration: true });
      title = meta.common.title || title;
      artist = meta.common.artist || artist;
      album = meta.common.album || '';
      duration = meta.format.duration || 0;
    } catch {
      // теги не прочитались — оставляем имя файла
    }
    await db.transaction('rw', db.tracks, db.files, async () => {
      const id = await db.tracks.add({ title, artist, album, duration, addedAt: Date.now() });
      await db.files.add({ id, blob: file });
    });
    onProgress(++done, files.length);
  }
}
