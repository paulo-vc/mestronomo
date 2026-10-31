import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import { FRAME_BYTES, SAMPLE_RATE, CHANNELS, type Bus, type Source } from './mixer';
import { CAPTURE_EXE, FFMPEG, YTDLP, YTDLP_JS_RUNTIME } from './paths';

const execFileAsync = promisify(execFile);


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
  // O próprio Mestrônomo fica de fora: capturar a si mesmo vira microfonia.
  return (JSON.parse(stdout) as AudioApp[]).filter((a) => a.pid !== process.pid);
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
export class FfmpegSource implements Source {
  volume = 1;
  ducks = true;
  paused = false;
  /** Quadros já tocados — dá a posição atual da faixa. */
  framesPlayed = 0;
  protected ffmpeg: ChildProcess;
  private queue = new PcmQueue();
  private decoded = false;
  private stopped = false;

  constructor(readonly bus: Bus, input: string, inputArgs: string[] = []) {
    this.ffmpeg = spawn(
      FFMPEG,
      ['-hide_banner', '-loglevel', 'error', ...inputArgs, '-i', input, '-f', 's16le', '-ar', String(SAMPLE_RATE), '-ac', String(CHANNELS), 'pipe:1'],
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
  constructor(readonly file: string, bus: Bus, readonly preview = false, loop = false) {
    // -stream_loop -1 repete o arquivo sem fim, sem o intervalo que reabrir o arquivo causaria.
    super(bus, file, loop ? ['-stream_loop', '-1'] : []);
  }
}

/**
 * Uma faixa do YouTube (ou outro site suportado pelo yt-dlp): yt-dlp baixa o áudio
 * e passa direto para o ffmpeg. Pausado por muito tempo, o YouTube pode fechar a conexão.
 */
export class StreamSource extends FfmpegSource {
  private ytdlp: ChildProcess;

  constructor(readonly url: string, bus: Bus = 'musica') {
    super(bus, 'pipe:0');
    this.ytdlp = spawn(
      YTDLP,
      ['-q', '--no-warnings', '--no-playlist', '-f', 'bestaudio/best', ...YTDLP_JS_RUNTIME.args, '-o', '-', url],
      { windowsHide: true, env: { ...process.env, ...YTDLP_JS_RUNTIME.env } },
    );
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
  /** Link (YouTube etc.) ou, para músicas locais, o caminho do arquivo. */
  url: string;
  title: string;
  /** Em segundos; ausente em lives. */
  duration?: number;
  /** Faixa local: toca o arquivo direto com o ffmpeg, sem yt-dlp. */
  local?: boolean;
}

/** Lê título e duração. Se for uma playlist, devolve todas as faixas dela. */
export async function resolveTracks(url: string): Promise<TrackInfo[]> {
  return parseTracks(await ytdlpPrint(url));
}

/** Busca no YouTube e devolve os primeiros resultados (sem tocar nada). */
export async function searchTracks(query: string, count = 5): Promise<TrackInfo[]> {
  return parseTracks(await ytdlpPrint(`ytsearch${count}:${query}`));
}

/** Um vídeo único (não playlist): dá para começar a tocar antes de saber o título. */
export function isSingleVideo(url: string) {
  return /youtu\.be\/|youtube\.com\/(watch|shorts\/)/.test(url) && !/[?&]list=/.test(url);
}

async function ytdlpPrint(target: string) {
  const { stdout } = await execFileAsync(
    YTDLP,
    ['--flat-playlist', '--no-warnings', ...YTDLP_JS_RUNTIME.args, '--print', '%(webpage_url,url)s\t%(title)s\t%(duration)s', target],
    { maxBuffer: 16 * 1024 * 1024, windowsHide: true, env: { ...process.env, ...YTDLP_JS_RUNTIME.env } },
  );
  return stdout;
}

function parseTracks(stdout: string): TrackInfo[] {
  return stdout
    .split('\n')
    .filter((line) => line.includes('\t'))
    .map((line) => {
      const [trackUrl, title, duration] = line.trim().split('\t');
      const seconds = Number(duration);
      return { url: trackUrl, title, duration: Number.isFinite(seconds) ? seconds : undefined };
    });
}

/** Duração de um arquivo local, lida do cabeçalho pelo ffmpeg ("Duration: 00:03:21.45"). */
export async function probeDuration(file: string): Promise<number | undefined> {
  const stderr = await new Promise<string>((resolve) => {
    execFile(FFMPEG, ['-hide_banner', '-i', file], { windowsHide: true }, (_err, _out, err) => resolve(String(err)));
  });
  const m = stderr.match(/Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : undefined;
}
