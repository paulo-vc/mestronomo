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

export type Bus = 'musica' | 'efeitos' | 'ambiente';

export interface Source {
  readonly bus: Bus;
  /** Volume próprio da fonte (0–1), aplicado antes do volume do bus. */
  volume: number;
  /** Áudio que o mestre já ouve direto no PC (capturas); fica fora do monitor no modo 'sem-capturas'. */
  readonly live?: boolean;
  /** Pré-escuta: toca só no monitor local, nunca vai para o bot. */
  readonly preview?: boolean;
  /** Preenche `out` (s16 intercalado, um quadro). Retorna false quando acabou e pode sair do mixer. */
  read(out: Int16Array): boolean;
  stop(): void;
}

/** Ajustes numéricos do mixer (os sliders). */
export type VolumeKey = 'musica' | 'efeitos' | 'ambiente' | 'master' | 'ducking' | 'monitorVolume';

/**
 * O que o mestre ouve no próprio fone:
 * - desligado: nada
 * - previa: só a pré-escuta (efeitos testados antes de soltar)
 * - sem-capturas: o que vai para o bot, menos os programas capturados (que você já ouve) + pré-escuta
 * - tudo: exatamente o que vai para o bot + pré-escuta
 */
export type MonitorMode = 'desligado' | 'previa' | 'sem-capturas' | 'tudo';

export interface MixerSettings {
  musica: number;
  efeitos: number;
  ambiente: number;
  master: number;
  /** Volume da música enquanto um efeito toca (0–1). 1 desliga o ducking. */
  ducking: number;
  monitor: MonitorMode;
  /** Volume do monitor local (0–1). Não afeta o que vai para o bot. */
  monitorVolume: number;
}

/**
 * Soma todas as fontes num único stream — o bot só consegue enviar um por canal de voz.
 * Roda num relógio próprio, então efeitos andam no tempo certo mesmo sem o bot conectado.
 */
export class Mixer extends EventEmitter {
  settings: MixerSettings = { musica: 0.8, efeitos: 1, ambiente: 0.7, master: 1, ducking: 0.35, monitor: 'sem-capturas', monitorVolume: 0.7 };

  private sources = new Set<Source>();
  /** Fades em andamento: ganho atual, alvo, passo por quadro e se a fonte sai do mixer ao chegar em 0. */
  private fades = new Map<Source, { gain: number; target: number; step: number; remove: boolean }>();
  private duckGain = 1;
  private scratch = new Int16Array(FRAME_VALUES);
  private acc = new Float32Array(FRAME_VALUES);
  private monitorAcc = new Float32Array(FRAME_VALUES);
  private encoder = new OpusScript(SAMPLE_RATE, CHANNELS, OpusScript.Application.AUDIO);
  private outputs = new Set<Readable>();
  private timer: NodeJS.Timeout | undefined;

  add(source: Source) {
    this.sources.add(source);
    this.emit('change');
  }

  remove(source: Source) {
    source.stop();
    this.fades.delete(source);
    if (this.sources.delete(source)) this.emit('change');
  }

  /** Adiciona a fonte começando do silêncio e subindo em `ms`. */
  fadeIn(source: Source, ms: number) {
    this.add(source);
    if (ms > 0) this.fades.set(source, { gain: 0, target: 1, step: FRAME_MS / ms, remove: false });
  }

  /** Abaixa até o silêncio em `ms` e então tira a fonte do mixer. */
  fadeOut(source: Source, ms: number) {
    if (!this.sources.has(source)) return;
    if (ms <= 0) return this.remove(source);
    const gain = this.fades.get(source)?.gain ?? 1;
    this.fades.set(source, { gain, target: 0, step: FRAME_MS / ms, remove: true });
  }

  has(source: Source) {
    return this.sources.has(source);
  }

  stopBus(bus: Bus) {
    for (const s of this.sources) if (s.bus === bus) this.remove(s);
  }

  /** Se há algo tocando no bus para os jogadores (a pré-escuta não conta). */
  isPlaying(bus: Bus) {
    for (const s of this.sources) if (s.bus === bus && !s.preview) return true;
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
    const { bot, monitor } = this.mix();
    if (monitor) this.emit('monitor', monitor);
    if (!bot || this.outputs.size === 0) return;
    const packet = this.encoder.encode(bot, FRAME_SAMPLES);
    for (const out of this.outputs) {
      if (out.readableLength < MAX_QUEUED_FRAMES) out.push(Buffer.from(packet));
    }
  }

  /**
   * Gera o quadro do bot e o do monitor local. Cada um vem undefined quando não há nada nele
   * (o player do Discord manda silêncio sozinho; o monitor simplesmente não recebe nada).
   */
  private mix(): { bot?: Buffer; monitor?: Buffer } {
    if (this.sources.size === 0) {
      this.duckGain = 1;
      return {};
    }
    const { musica, efeitos, ambiente, master, ducking, monitor: mode } = this.settings;
    const busGain = { musica, efeitos, ambiente };
    const duckFrom = this.duckGain;
    const target = this.isPlaying('efeitos') ? ducking : 1;
    // Abaixa rápido (~60 ms) e volta devagar (~500 ms), como um ducking de rádio.
    this.duckGain += (target - this.duckGain) * (target < this.duckGain ? 0.3 : 0.04);
    const duckTo = this.duckGain;

    this.acc.fill(0);
    this.monitorAcc.fill(0);
    let botUsed = false;
    let monitorUsed = false;
    const finished: Source[] = [];
    for (const source of [...this.sources]) {
      this.scratch.fill(0);
      const alive = source.read(this.scratch);
      const toBot = !source.preview;
      const toMonitor =
        mode !== 'desligado' && (source.preview || mode === 'tudo' || (mode === 'sem-capturas' && !source.live));
      const fade = this.fades.get(source);
      const fadeFrom = fade?.gain ?? 1;
      if (fade) {
        fade.gain = fade.target > fade.gain ? Math.min(fade.target, fade.gain + fade.step) : Math.max(fade.target, fade.gain - fade.step);
        if (fade.gain === fade.target) {
          this.fades.delete(source);
          if (fade.remove) finished.push(source);
        }
      }
      const fadeTo = fade?.gain ?? 1;
      if (toBot || toMonitor) {
        const gain = busGain[source.bus] * source.volume;
        const ducked = source.bus === 'musica' && toBot;
        for (let i = 0; i < FRAME_VALUES; i++) {
          // Ducking e fade são interpolados dentro do quadro para não gerar estalos.
          const t = i / FRAME_VALUES;
          const duck = ducked ? duckFrom + (duckTo - duckFrom) * t : 1;
          const v = this.scratch[i] * gain * duck * (fadeFrom + (fadeTo - fadeFrom) * t);
          if (toBot) this.acc[i] += v;
          if (toMonitor) this.monitorAcc[i] += v;
        }
        botUsed ||= toBot;
        monitorUsed ||= toMonitor;
      }
      if (!alive) {
        this.remove(source);
        this.emit('ended', source);
      }
    }
    // Fontes que terminaram um fade-out saem sem 'ended': foi o mestre que tirou, não a faixa que acabou.
    for (const source of finished) this.remove(source);
    return {
      bot: botUsed ? toPcm(this.acc, master) : undefined,
      monitor: monitorUsed ? toPcm(this.monitorAcc, master) : undefined,
    };
  }
}

function toPcm(acc: Float32Array, gain: number) {
  const out = Buffer.allocUnsafe(FRAME_BYTES);
  for (let i = 0; i < FRAME_VALUES; i++) {
    const v = Math.round(acc[i] * gain);
    out.writeInt16LE(v > 32767 ? 32767 : v < -32768 ? -32768 : v, i * 2);
  }
  return out;
}
