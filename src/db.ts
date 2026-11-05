import Dexie, { type Table } from 'dexie';

export interface Track {
  id: number;
  title: string;
  artist: string;
  album: string;
  duration: number;
  addedAt: number;
}

export interface TrackFile {
  id: number; // совпадает с Track.id
  blob: Blob;
}

class PlayerDB extends Dexie {
  tracks!: Table<Track, number, Omit<Track, 'id'>>;
  files!: Table<TrackFile, number>;

  constructor() {
    super('player');
    this.version(1).stores({
      tracks: '++id, title, artist, addedAt',
      files: 'id'
    });
  }
}

export const db = new PlayerDB();
