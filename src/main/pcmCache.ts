import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { CHANNELS, FRAME_VALUES, SAMPLE_RATE } from './audioFormat';
import type { Bus, Source } from './mixer';
import { FFMPEG } from './paths';
import { FileSource } from './sources';

// Sons curtos (efeitos, loops de ambiente) decodificados uma vez e guardados na memória.
// Tocar da memória começa na hora e não deixa um ffmpeg (+ console) aberto por som:
// cada processo desses custa ~24 MB, enquanto 10 s de áudio decodificado custam ~1,9 MB.

interface Entry {
  pcm: Int16Array;
  mtime: number;
  usadoEm: number;
}

export class PcmCache {
  private entries = new Map<string, Entry>();
  private loading = new Map<string, Promise<Int16Array | undefined>>();
  /** Arquivos que passaram do limite: tocam sempre por streaming. */
  private grandes = new Set<string>();
  private bytes = 0;

  constructor(
    private budgetBytes = 64 * 1024 * 1024,
    /** ~2 min de áudio; acima disso o arquivo é tocado por streaming. */
    private maxFileBytes = 24 * 1024 * 1024,
  ) {}

  /** O PCM já decodificado, se estiver na memória e o arquivo não mudou. */
  get(file: string): Int16Array | undefined {
    const e = this.entries.get(file);
    if (!e) return undefined;
    if (mtime(file) !== e.mtime) {
      this.drop(file);
      return undefined;
    }
    e.usadoEm = Date.now();
    return e.pcm;
  }

  /** Decodifica em segundo plano (uma vez por arquivo). Resolve undefined se o arquivo for grande demais. */
  load(file: string): Promise<Int16Array | undefined> {
    const pronto = this.get(file);
    if (pronto) return Promise.resolve(pronto);
    if (this.grandes.has(file)) return Promise.resolve(undefined);
    const emAndamento = this.loading.get(file);
    if (emAndamento) return emAndamento;
    const p = this.decode(file).finally(() => this.loading.delete(file));
    this.loading.set(file, p);
    return p;
  }

  /** Pré-carrega uma lista, um arquivo por vez, para não disputar CPU com o que está tocando. */
  async warm(files: string[]) {
    for (const f of files) {
      if (this.bytes >= this.budgetBytes) return;
      await this.load(f);
    }
  }

  stats() {
    return { arquivos: this.entries.size, mb: +(this.bytes / 1024 / 1024).toFixed(1) };
  }

  private decode(file: string): Promise<Int16Array | undefined> {
    return new Promise((resolve) => {
      const proc = spawn(
        FFMPEG,
        ['-hide_banner', '-loglevel', 'error', '-i', file, '-f', 's16le', '-ar', String(SAMPLE_RATE), '-ac', String(CHANNELS), 'pipe:1'],
        { windowsHide: true },
      );
      const partes: Buffer[] = [];
      let total = 0;
      proc.stdout.on('data', (chunk: Buffer) => {
        total += chunk.length;
        if (total > this.maxFileBytes) {
          this.grandes.add(file);
          proc.kill();
          return;
        }
        partes.push(chunk);
      });
      proc.on('error', () => resolve(undefined));
      proc.on('close', () => {
        if (this.grandes.has(file) || total === 0) return resolve(undefined);
        const buf = Buffer.concat(partes, total - (total % 2));
        // Cópia alinhada: o Buffer do Node pode começar num offset ímpar do ArrayBuffer.
        const pcm = new Int16Array(buf.length / 2);
        pcm.set(new Int16Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length)));
        this.store(file, pcm);
        resolve(pcm);
      });
    });
  }

  private store(file: string, pcm: Int16Array) {
    this.entries.set(file, { pcm, mtime: mtime(file), usadoEm: Date.now() });
    this.bytes += pcm.byteLength;
    // Passou do orçamento: tira os menos usados recentemente.
    const porUso = [...this.entries].sort((a, b) => a[1].usadoEm - b[1].usadoEm);
    for (const [f] of porUso) {
      if (this.bytes <= this.budgetBytes || f === file) break;
      this.drop(f);
    }
  }

  private drop(file: string) {
    const e = this.entries.get(file);
    if (!e) return;
    this.bytes -= e.pcm.byteLength;
    this.entries.delete(file);
  }
}

function mtime(file: string) {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return -1;
  }
}

/** Toca um PCM já na memória: sem processos, início imediato. */
export class MemorySource implements Source {
  volume = 1;
  ducks = true;
  paused = false;
  framesPlayed = 0;
  private pos = 0;
  private stopped = false;

  constructor(
    private pcm: Int16Array,
    readonly bus: Bus,
    readonly preview = false,
    private loop = false,
  ) {}

  get seconds() {
    return this.pos / CHANNELS / SAMPLE_RATE;
  }

  read(out: Int16Array) {
    if (this.stopped) return false;
    if (this.paused) return true;
    let escrito = 0;
    while (escrito < FRAME_VALUES) {
      const n = Math.min(FRAME_VALUES - escrito, this.pcm.length - this.pos);
      out.set(this.pcm.subarray(this.pos, this.pos + n), escrito);
      escrito += n;
      this.pos += n;
      if (this.pos >= this.pcm.length) {
        if (!this.loop) break;
        this.pos = 0;
      }
    }
    this.framesPlayed++;
    return this.loop || this.pos < this.pcm.length;
  }

  stop() {
    this.stopped = true;
  }
}

/**
 * Fonte para um arquivo: da memória se já estiver decodificado; senão por streaming com o
 * ffmpeg (como antes) e decodifica em segundo plano para a próxima vez.
 */
export function playFile(cache: PcmCache | undefined, file: string, bus: Bus, preview = false, loop = false): MemorySource | FileSource {
  const pcm = cache?.get(file);
  if (pcm) return new MemorySource(pcm, bus, preview, loop);
  cache?.load(file);
  return new FileSource(file, bus, preview, loop);
}
