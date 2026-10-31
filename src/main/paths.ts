import path from 'node:path';

// Onde ficam os executáveis auxiliares. Em desenvolvimento vêm do projeto e do PATH;
// no app instalado vêm de resources/bin (copiados por scripts/preparar-vendor.js).
// Este módulo não importa o Electron para continuar usável em testes com Node puro.

export const ROOT = path.join(__dirname, '..', '..');
export const PACKAGED = __dirname.includes('app.asar');

const BIN = PACKAGED ? path.join(process.resourcesPath, 'bin') : undefined;

export const CAPTURE_EXE = BIN
  ? path.join(BIN, 'mestronomo-capture.exe')
  : path.join(ROOT, 'capture', 'target', 'release', 'mestronomo-capture.exe');

export const FFMPEG = BIN ? path.join(BIN, 'ffmpeg.exe') : process.env.FFMPEG_PATH || 'ffmpeg';

export const YTDLP = BIN ? path.join(BIN, 'yt-dlp.exe') : process.env.YTDLP_PATH || 'yt-dlp';

/**
 * O yt-dlp precisa de um runtime JavaScript para o YouTube. Em vez de exigir Node instalado,
 * usamos o próprio executável do Electron rodando como Node (ELECTRON_RUN_AS_NODE).
 */
export const YTDLP_JS_RUNTIME = { args: ['--js-runtimes', `node:${process.execPath}`], env: { ELECTRON_RUN_AS_NODE: '1' } };
