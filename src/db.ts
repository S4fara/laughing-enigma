import Dexie, { type Table } from 'dexie';

export interface Track {
  id: number;
  title: string;
  artist: string;
  album: string;
  duration: number;
  addedAt: number;
  cover?: Blob;
  coverTried?: boolean;
  peaks?: number[];
  peaksTried?: boolean;
  remoteId?: string; // id трека в облаке (Telegram-бот)
}

export interface TrackFile {
  id: number; // совпадает с Track.id
  blob: Blob;
}

export interface Playlist {
  id: number;
  name: string;
  trackIds: number[];
  createdAt: number;
  remoteId?: number; // id плейлиста в облаке
}

class PlayerDB extends Dexie {
  tracks!: Table<Track, number, Omit<Track, 'id'>>;
  files!: Table<TrackFile, number>;
  playlists!: Table<Playlist, number, Omit<Playlist, 'id'>>;

  constructor() {
    super('player');
    this.version(1).stores({
      tracks: '++id, title, artist, addedAt',
      files: 'id'
    });
    this.version(2).stores({
      tracks: '++id, title, artist, addedAt',
      files: 'id',
      playlists: '++id, createdAt'
    });
  }
}

export const db = new PlayerDB();

export async function deleteTrack(id: number) {
  await db.transaction('rw', db.tracks, db.files, db.playlists, async () => {
    await db.tracks.delete(id);
    await db.files.delete(id);
    await db.playlists.toCollection().modify((p) => {
      p.trackIds = p.trackIds.filter((t) => t !== id);
    });
  });
}
