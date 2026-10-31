// Junta em vendor/ os executáveis que vão dentro do instalador (resources/bin):
// o capturador compilado, e o ffmpeg e o yt-dlp encontrados no PATH desta máquina.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const VENDOR = path.join(ROOT, 'vendor');

/** Procura no PATH e, se não achar, nos pacotes do winget (terminais abertos antes da instalação não veem o PATH novo). */
function which(exe) {
  try {
    return execFileSync('where', [exe], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split(/\r?\n/).find(Boolean);
  } catch {
    const winget = path.join(process.env.LOCALAPPDATA ?? '', 'Microsoft', 'WinGet', 'Packages');
    if (!fs.existsSync(winget)) return undefined;
    for (const pkg of fs.readdirSync(winget)) {
      const found = findFile(path.join(winget, pkg), exe, 3);
      if (found) return found;
    }
  }
}

function findFile(dir, name, depth) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isFile() && entry.name.toLowerCase() === name.toLowerCase()) return full;
    if (entry.isDirectory() && depth > 0) {
      const found = findFile(full, name, depth - 1);
      if (found) return found;
    }
  }
}

const files = {
  'mestronomo-capture.exe': path.join(ROOT, 'capture', 'target', 'release', 'mestronomo-capture.exe'),
  'ffmpeg.exe': which('ffmpeg.exe'),
  'yt-dlp.exe': which('yt-dlp.exe'),
};

fs.rmSync(VENDOR, { recursive: true, force: true });
fs.mkdirSync(VENDOR);
for (const [name, source] of Object.entries(files)) {
  if (!source || !fs.existsSync(source)) {
    console.error(`Não encontrei ${name}. ${name === 'mestronomo-capture.exe' ? 'Rode npm run build:capture.' : 'Instale e deixe no PATH.'}`);
    process.exit(1);
  }
  fs.copyFileSync(source, path.join(VENDOR, name));
  console.log(`${name.padEnd(24)} ← ${source}`);
}
