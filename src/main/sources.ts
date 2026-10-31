import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { FRAME_BYTES, SAMPLE_RATE, CHANNELS, type Bus, type Source } from './mixer';

const execFileAsync = promisify(execFile);

export const CAPTURE_EXE = path.join(__dirname, '..', '..', 'capture', 'target', 'release', 'mestronomo-capture.exe');

/** Acumula PCM vindo de um processo e entrega um quadro por vez. */
class PcmQueue {
  private chunks: Buffer[] = [];
  length = 0;

  push(chunk: Buffer) {
    this.chunks.push(chunk);
    this.length += chunk.length;
  }

  /** Copia até um quadro para `out`; o que faltar fica como silêncio. */
  readInto(out: Int16Array) {
    const target = Buffer.from(out.buffer, out.byteOffset, out.byteLength);
    let written = 0;
    while (written < FRAME_BYTES && this.chunks.length > 0) {
      const head = this.chunks[0];
      const n = head.copy(target, written, 0, Math.min(head.length, FRAME_BYTES - written));
      written += n;
      this.length -= n;
      if (n === head.length) this.chunks.shift();
      else this.chunks[0] = head.subarray(n);
    }
  }

  /** Descarta o excesso antigo para a latência não crescer. */
  trimTo(maxBytes: number) {
    while (this.length > maxBytes && this.chunks.length > 0) {
      const extra = this.length - maxBytes;
      const head = this.chunks[0];
      if (head.length <= extra) {
        this.chunks.shift();
        this.length -= head.length;
      } else {
        this.chunks[0] = head.subarray(extra);
        this.length -= extra;
      }
    }
  }
}

export interface AudioApp {
  name: string;
  pid: number;
  active: boolean;
}

export async function listAudioApps(): Promise<AudioApp[]> {
  const { stdout } = await execFileAsync(CAPTURE_EXE, ['list']);
  return JSON.parse(stdout);
}

/** Áudio ao vivo de outro programa (Spotify, navegador...) via mestronomo-capture. */
export class AppCaptureSource implements Source {
  readonly bus: Bus = 'musica';
  private queue = new PcmQueue();
  private proc: ChildProcess;
  private ended = false;

  constructor(readonly appName: string, onExit: (error?: string) => void) {
    this.proc = spawn(CAPTURE_EXE, ['capture', appName], { windowsHide: true });
    let stderr = '';
    this.proc.stdout!.on('data', (chunk: Buffer) => {
      this.queue.push(chunk);
      // Mais de ~100 ms acumulado significa que estamos atrasados em relação ao app.
      this.queue.trimTo(FRAME_BYTES * 5);
    });
    this.proc.stderr!.on('data', (d) => (stderr += d));
    this.proc.on('exit', (code) => {
      this.ended = true;
      onExit(code ? stderr.trim() || `código ${code}` : undefined);
    });
  }

  read(out: Int16Array) {
    this.queue.readInto(out);
    return !this.ended;
  }

  stop() {
    this.ended = true;
    this.proc.kill();
  }
}

/** Um arquivo de áudio decodificado pelo ffmpeg (efeitos da soundboard). */
export class FileSource implements Source {
  private queue = new PcmQueue();
  private proc: ChildProcess;
  private decoded = false;
  private stopped = false;

  constructor(readonly file: string, readonly bus: Bus) {
    this.proc = spawn(
      'ffmpeg',
      ['-hide_banner', '-loglevel', 'error', '-i', file, '-f', 's16le', '-ar', String(SAMPLE_RATE), '-ac', String(CHANNELS), 'pipe:1'],
      { windowsHide: true },
    );
    const stdout = this.proc.stdout!;
    stdout.on('data', (chunk: Buffer) => {
      this.queue.push(chunk);
      // O ffmpeg decodifica bem mais rápido que o tempo real; segura com ~1 s de folga.
      if (this.queue.length > FRAME_BYTES * 50) stdout.pause();
    });
    this.proc.on('exit', () => (this.decoded = true));
    this.proc.on('error', () => (this.decoded = true));
  }

  read(out: Int16Array) {
    this.queue.readInto(out);
    if (this.queue.length < FRAME_BYTES * 25) this.proc.stdout?.resume();
    return !this.stopped && !(this.decoded && this.queue.length === 0);
  }

  stop() {
    this.stopped = true;
    this.proc.kill();
  }
}
