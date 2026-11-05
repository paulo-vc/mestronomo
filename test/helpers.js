// Utilitários dos testes: módulos compilados, pastas temporárias e WAVs gerados em JS puro.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DIST = path.join(__dirname, '..', 'dist', 'main');

/** Módulo compilado de src/main (rode `npm run build` antes; `npm test` já faz). */
const load = (nome) => require(path.join(DIST, `${nome}.js`));

/** Pasta temporária apagada no fim do teste. */
function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mestronomo-teste-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  return dir;
}

/** WAV estéreo 48 kHz s16 com um tom senoidal (ou silêncio, com freq 0). */
function makeWav(file, seconds, freq = 440, amp = 0.3) {
  const n = Math.round(48000 * seconds);
  const data = Buffer.alloc(n * 4);
  for (let i = 0; i < n; i++) {
    const v = Math.round(Math.sin((2 * Math.PI * freq * i) / 48000) * amp * 32767);
    data.writeInt16LE(v, i * 4);
    data.writeInt16LE(v, i * 4 + 2);
  }
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write('WAVEfmt ', 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(2, 22);
  h.writeUInt32LE(48000, 24);
  h.writeUInt32LE(48000 * 4, 28);
  h.writeUInt16LE(4, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(data.length, 40);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.concat([h, data]));
  return file;
}

const temFfmpeg = (() => {
  try {
    execFileSync(process.env.FFMPEG_PATH || 'ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

/** Opções para testes que precisam do ffmpeg: pulados se ele não estiver no PATH. */
const precisaFfmpeg = { skip: temFfmpeg ? false : 'ffmpeg não encontrado no PATH' };

/** Gerador pseudoaleatório previsível (para dados e sorteios). */
function sequencia(valores) {
  let i = 0;
  return () => valores[i++ % valores.length];
}

const rms = (buf) => Math.sqrt(buf.reduce((s, v) => s + v * v, 0) / buf.length);

module.exports = { load, tempDir, makeWav, precisaFfmpeg, sequencia, rms };
