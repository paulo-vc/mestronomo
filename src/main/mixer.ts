import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import OpusScript from 'opusscript';

export const SAMPLE_RATE = 48_000;
export const CHANNELS = 2;
/** 20 ms por quadro — o ritmo em que o Discord consome áudio. */
export const FRAME_MS = 20;
export const FRAME_SAMPLES = (SAMPLE_RATE / 1000) * FRAME_MS;
export const FRAME_VALUES = FRAME_SAMPLES * CHANNELS;
export const FRAME_BYTES = FRAME_VALUES * 2;

/** Quadros Opus esperando o Discord; acima disso descartamos para não acumular atraso. */
const MAX_QUEUED_FRAMES = 3;

export type Bus = 'musica' | 'efeitos';

export interface Source {
  readonly bus: Bus;
  /** Volume próprio da fonte (0–1), aplicado antes do volume do bus. */
  volume: number;
  /** Preenche `out` (s16 intercalado, um quadro). Retorna false quando acabou e pode sair do mixer. */
  read(out: Int16Array): boolean;
  stop(): void;
}

export interface MixerSettings {
  musica: number;
  efeitos: number;
  master: number;
  /** Volume da música enquanto um efeito toca (0–1). 1 desliga o ducking. */
  ducking: number;
}

/**
 * Soma todas as fontes num único stream — o bot só consegue enviar um por canal de voz.
 * Roda num relógio próprio, então efeitos andam no tempo certo mesmo sem o bot conectado.
 */
export class Mixer extends EventEmitter {
  settings: MixerSettings = { musica: 0.8, efeitos: 1, master: 1, ducking: 0.35 };

  private sources = new Set<Source>();
  private duckGain = 1;
  private scratch = new Int16Array(FRAME_VALUES);
  private acc = new Float32Array(FRAME_VALUES);
  private encoder = new OpusScript(SAMPLE_RATE, CHANNELS, OpusScript.Application.AUDIO);
  private outputs = new Set<Readable>();
  private timer: NodeJS.Timeout | undefined;

  add(source: Source) {
    this.sources.add(source);
    this.emit('change');
  }

  remove(source: Source) {
    source.stop();
    if (this.sources.delete(source)) this.emit('change');
  }

  stopBus(bus: Bus) {
    for (const s of this.sources) if (s.bus === bus) this.remove(s);
  }

  isPlaying(bus: Bus) {
    for (const s of this.sources) if (s.bus === bus) return true;
    return false;
  }

  start() {
    let next = performance.now();
    const tick = () => {
      // setTimeout no Windows tem resolução grosseira; compensamos gerando os quadros atrasados.
      while (next <= performance.now()) {
        this.emitFrame();
        next += FRAME_MS;
      }
      this.timer = setTimeout(tick, Math.max(1, next - performance.now()));
    };
    tick();
  }

  stop() {
    clearTimeout(this.timer);
    for (const s of this.sources) s.stop();
    this.sources.clear();
    for (const out of this.outputs) out.push(null);
  }

  /** Stream de pacotes Opus para o @discordjs/voice (StreamType.Opus). */
  createOpusStream(): Readable {
    const stream = new Readable({ objectMode: true, read() {} });
    this.outputs.add(stream);
    stream.on('close', () => this.outputs.delete(stream));
    return stream;
  }

  private emitFrame() {
    const pcm = this.mix();
    if (!pcm || this.outputs.size === 0) return;
    const packet = this.encoder.encode(pcm, FRAME_SAMPLES);
    for (const out of this.outputs) {
      if (out.readableLength < MAX_QUEUED_FRAMES) out.push(Buffer.from(packet));
    }
  }

  /** Retorna o quadro mixado, ou undefined se não há nada tocando (o player manda silêncio sozinho). */
  private mix(): Buffer | undefined {
    if (this.sources.size === 0) {
      this.duckGain = 1;
      return undefined;
    }
    const { musica, efeitos, master, ducking } = this.settings;
    const duckFrom = this.duckGain;
    const target = this.isPlaying('efeitos') ? ducking : 1;
    // Abaixa rápido (~60 ms) e volta devagar (~500 ms), como um ducking de rádio.
    this.duckGain += (target - this.duckGain) * (target < this.duckGain ? 0.3 : 0.04);
    const duckTo = this.duckGain;

    this.acc.fill(0);
    for (const source of [...this.sources]) {
      this.scratch.fill(0);
      const alive = source.read(this.scratch);
      if (source.bus === 'efeitos') {
        const gain = efeitos * source.volume;
        for (let i = 0; i < FRAME_VALUES; i++) this.acc[i] += this.scratch[i] * gain;
      } else {
        const gain = musica * source.volume;
        // Interpola o ganho dentro do quadro para não gerar estalos.
        for (let i = 0; i < FRAME_VALUES; i++) {
          const duck = duckFrom + ((duckTo - duckFrom) * i) / FRAME_VALUES;
          this.acc[i] += this.scratch[i] * gain * duck;
        }
      }
      if (!alive) {
        this.remove(source);
        this.emit('ended', source);
      }
    }

    const out = Buffer.allocUnsafe(FRAME_BYTES);
    for (let i = 0; i < FRAME_VALUES; i++) {
      const v = Math.round(this.acc[i] * master);
      out.writeInt16LE(v > 32767 ? 32767 : v < -32768 ? -32768 : v, i * 2);
    }
    return out;
  }
}
