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
  readonly live = true;
  volume = 1;
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

/**
 * Áudio decodificado pelo ffmpeg a partir de um arquivo ou do stdin.
 * O ffmpeg decodifica bem mais rápido que o tempo real, então seguramos com ~1 s de folga.
 */
class FfmpegSource implements Source {
  volume = 1;
  paused = false;
  /** Quadros já tocados — dá a posição atual da faixa. */
  framesPlayed = 0;
  protected ffmpeg: ChildProcess;
  private queue = new PcmQueue();
  private decoded = false;
  private stopped = false;

  constructor(readonly bus: Bus, input: string) {
    this.ffmpeg = spawn(
      'ffmpeg',
      ['-hide_banner', '-loglevel', 'error', '-i', input, '-f', 's16le', '-ar', String(SAMPLE_RATE), '-ac', String(CHANNELS), 'pipe:1'],
      { windowsHide: true },
    );
    const stdout = this.ffmpeg.stdout!;
    stdout.on('data', (chunk: Buffer) => {
      this.queue.push(chunk);
      if (this.queue.length > FRAME_BYTES * 50) stdout.pause();
    });
    this.ffmpeg.on('exit', () => (this.decoded = true));
    this.ffmpeg.on('error', () => (this.decoded = true));
  }

  get seconds() {
    return (this.framesPlayed * FRAME_BYTES) / (SAMPLE_RATE * CHANNELS * 2);
  }

  read(out: Int16Array) {
    if (this.stopped) return false;
    if (this.paused) return true;
    const before = this.queue.length;
    this.queue.readInto(out);
    if (this.queue.length < before) this.framesPlayed++;
    if (this.queue.length < FRAME_BYTES * 25) this.ffmpeg.stdout?.resume();
    return !(this.decoded && this.queue.length === 0);
  }

  stop() {
    this.stopped = true;
    this.ffmpeg.kill();
  }
}

/** Um arquivo local (efeitos da soundboard). Com `preview`, toca só no monitor local. */
export class FileSource extends FfmpegSource {
  constructor(readonly file: string, bus: Bus, readonly preview = false) {
    super(bus, file);
  }
}

export const YTDLP = process.env.YTDLP_PATH || 'yt-dlp';

/**
 * Uma faixa do YouTube (ou outro site suportado pelo yt-dlp): yt-dlp baixa o áudio
 * e passa direto para o ffmpeg. Pausado por muito tempo, o YouTube pode fechar a conexão.
 */
export class StreamSource extends FfmpegSource {
  private ytdlp: ChildProcess;

  constructor(readonly url: string, bus: Bus = 'musica') {
    super(bus, 'pipe:0');
    this.ytdlp = spawn(YTDLP, ['-q', '--no-warnings', '--no-playlist', '-f', 'bestaudio/best', '--js-runtimes', 'node', '-o', '-', url], {
      windowsHide: true,
    });
    this.ytdlp.stdout!.pipe(this.ffmpeg.stdin!);
    // ffmpeg fechado antes do fim (faixa pulada) gera EPIPE no stdin; é esperado.
    this.ffmpeg.stdin!.on('error', () => {});
    this.ytdlp.on('error', () => this.ffmpeg.stdin!.end());
  }

  stop() {
    super.stop();
    this.ytdlp.kill();
  }
}

export interface TrackInfo {
  url: string;
  title: string;
  /** Em segundos; ausente em lives. */
  duration?: number;
}

/** Lê título e duração. Se for uma playlist, devolve todas as faixas dela. */
export async function resolveTracks(url: string): Promise<TrackInfo[]> {
  const { stdout } = await execFileAsync(
    YTDLP,
    ['--flat-playlist', '--no-warnings', '--print', '%(webpage_url,url)s\t%(title)s\t%(duration)s', url],
    { maxBuffer: 16 * 1024 * 1024, windowsHide: true },
  );
  return stdout
    .split('\n')
    .filter((line) => line.includes('\t'))
    .map((line) => {
      const [trackUrl, title, duration] = line.trim().split('\t');
      const seconds = Number(duration);
      return { url: trackUrl, title, duration: Number.isFinite(seconds) ? seconds : undefined };
    });
}
