// Filtros de ambiente aplicados à mixagem inteira (estéreo intercalado, 48 kHz).
// Cada filtro tem um "wet" que sobe e desce em ~300 ms ao ligar e desligar, sem estalos.

import { CHANNELS, FRAME_MS, SAMPLE_RATE } from './audioFormat';

export type FilterName = 'abafado' | 'caverna' | 'eco';
export const FILTERS: FilterName[] = ['abafado', 'caverna', 'eco'];
export type FilterSettings = Record<FilterName, boolean>;

const RAMP_STEP = FRAME_MS / 300;

/** Passa-baixa biquad (RBJ): som "atrás da porta". */
class LowPass {
  private b0: number;
  private b1: number;
  private b2: number;
  private a1: number;
  private a2: number;
  private x1 = new Float32Array(CHANNELS);
  private x2 = new Float32Array(CHANNELS);
  private y1 = new Float32Array(CHANNELS);
  private y2 = new Float32Array(CHANNELS);

  constructor(freq: number, q = 0.7) {
    const w = (2 * Math.PI * freq) / SAMPLE_RATE;
    const alpha = Math.sin(w) / (2 * q);
    const cos = Math.cos(w);
    const a0 = 1 + alpha;
    this.b0 = (1 - cos) / 2 / a0;
    this.b1 = (1 - cos) / a0;
    this.b2 = (1 - cos) / 2 / a0;
    this.a1 = (-2 * cos) / a0;
    this.a2 = (1 - alpha) / a0;
  }

  sample(x: number, ch: number) {
    const y = this.b0 * x + this.b1 * this.x1[ch] + this.b2 * this.x2[ch] - this.a1 * this.y1[ch] - this.a2 * this.y2[ch];
    this.x2[ch] = this.x1[ch];
    this.x1[ch] = x;
    this.y2[ch] = this.y1[ch];
    this.y1[ch] = y;
    return y;
  }
}

/** Linha de atraso circular com realimentação (eco e os pentes da reverberação). */
class Delay {
  private buf: Float32Array;
  private pos = 0;
  constructor(samples: number, private feedback: number, private damp = 0) {
    this.buf = new Float32Array(samples);
  }
  private last = 0;
  /** Pente com amortecimento (Freeverb): devolve a saída atrasada e realimenta. */
  comb(x: number) {
    const out = this.buf[this.pos];
    this.last = out * (1 - this.damp) + this.last * this.damp;
    this.buf[this.pos] = x + this.last * this.feedback;
    if (++this.pos >= this.buf.length) this.pos = 0;
    return out;
  }
  /** Passa-tudo, que espalha os ecos da reverberação. */
  allpass(x: number) {
    const atrasado = this.buf[this.pos];
    const out = -x + atrasado;
    this.buf[this.pos] = x + atrasado * this.feedback;
    if (++this.pos >= this.buf.length) this.pos = 0;
    return out;
  }
}

/** Reverberação estilo Freeverb, reduzida (4 pentes + 2 passa-tudo por canal). */
class Reverb {
  private combs: Delay[][];
  private allpasses: Delay[][];
  constructor() {
    // Tamanhos do Freeverb (em amostras a 44,1 kHz), ajustados para 48 kHz; o canal direito é um pouco maior.
    const escala = SAMPLE_RATE / 44100;
    const combs = [1557, 1617, 1491, 1422];
    const allpasses = [556, 441];
    this.combs = [0, 23].map((spread) => combs.map((n) => new Delay(Math.round((n + spread) * escala), 0.84, 0.2)));
    this.allpasses = [0, 23].map((spread) => allpasses.map((n) => new Delay(Math.round((n + spread) * escala), 0.5)));
  }
  sample(x: number, ch: number) {
    let soma = 0;
    for (const c of this.combs[ch]) soma += c.comb(x * 0.25);
    for (const a of this.allpasses[ch]) soma = a.allpass(soma);
    return soma;
  }
}

/** Uma cadeia de filtros com estado próprio (o bot e o monitor têm uma cada). */
export class FilterChain {
  private wet: Record<FilterName, number> = { abafado: 0, caverna: 0, eco: 0 };
  private lowpass = new LowPass(650);
  private reverb = new Reverb();
  private echo = [0, 1].map(() => new Delay(Math.round(SAMPLE_RATE * 0.32), 0.42));

  /** Aplica no lugar. Retorna false quando nada está ligado nem em transição (custo zero). */
  process(buf: Float32Array, ativos: FilterSettings) {
    const de = { ...this.wet };
    let algum = false;
    for (const f of FILTERS) {
      const alvo = ativos[f] ? 1 : 0;
      this.wet[f] += Math.max(-RAMP_STEP, Math.min(RAMP_STEP, alvo - this.wet[f]));
      if (this.wet[f] > 0 || de[f] > 0) algum = true;
    }
    if (!algum) return false;

    const n = buf.length;
    for (let i = 0; i < n; i++) {
      const ch = i % CHANNELS;
      const t = i / n;
      let x = buf[i];
      const wLow = de.abafado + (this.wet.abafado - de.abafado) * t;
      if (wLow > 0) x = x + (this.lowpass.sample(x, ch) - x) * wLow;
      const wRev = de.caverna + (this.wet.caverna - de.caverna) * t;
      if (wRev > 0) x = x + this.reverb.sample(x, ch) * 0.45 * wRev;
      const wEco = de.eco + (this.wet.eco - de.eco) * t;
      if (wEco > 0) x = x + this.echo[ch].comb(x) * 0.5 * wEco;
      buf[i] = x;
    }
    return true;
  }
}
