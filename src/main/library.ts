import fs from 'node:fs';
import path from 'node:path';
import { AUDIO_EXT } from './ambience';
import { probeDuration, type TrackInfo } from './sources';

// Músicas locais: cada subpasta de musicas/ é uma playlist; arquivos soltos formam "Soltas".

export const LOOSE = 'Soltas';

export function listPlaylists(dir: string): string[] {
  fs.mkdirSync(dir, { recursive: true });
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const folders = entries
    .filter((e) => e.isDirectory() && audioFiles(path.join(dir, e.name)).length > 0)
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true }));
  return audioFiles(dir).length > 0 ? [...folders, LOOSE] : folders;
}

/** Faixas de uma playlist, com duração lida pelo ffmpeg (4 arquivos por vez). */
export async function loadPlaylist(dir: string, name: string): Promise<TrackInfo[]> {
  const folder = name === LOOSE ? dir : path.join(dir, path.basename(name));
  const files = audioFiles(folder);
  const tracks: TrackInfo[] = files.map((f) => ({
    url: path.join(folder, f),
    title: f.replace(/\.[^.]+$/, '').replace(/^\d+[\s._-]+/, ''),
    local: true,
  }));
  for (let i = 0; i < tracks.length; i += 4) {
    await Promise.all(tracks.slice(i, i + 4).map(async (t) => (t.duration = await probeDuration(t.url))));
  }
  return tracks;
}

function audioFiles(folder: string) {
  return fs
    .readdirSync(folder)
    .filter((f) => AUDIO_EXT.has(path.extname(f).toLowerCase()))
    .sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true }));
}
