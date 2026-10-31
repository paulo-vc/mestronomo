import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import type { Mixer } from './mixer';
import { FileSource } from './sources';

export const AUDIO_EXT = new Set(['.mp3', '.ogg', '.wav', '.flac', '.m4a', '.opus', '.webm']);

/** Uma camada contínua (chuva, fogueira, vento...) tocando em loop. */
export interface Layer {
  arquivo: string;
  volume: number;
}

/** Sons soltos de vez em quando: um arquivo sorteado da lista a cada `min`–`max` segundos. */
export interface Occasional {
  id: string;
  arquivos: string[];
  min: number;
  max: number;
  volume: number;
}

export interface AmbienceState {
  arquivos: string[];
  camadas: Layer[];
  ocasionais: Occasional[];
}

/**
 * Ambiente da mesa: camadas em loop e sons ocasionais, todos no bus "ambiente".
 * Arquivos vêm da pasta de ambientes. Emite 'change' com o estado.
 */
export class Ambience extends EventEmitter {
  private layers = new Map<string, FileSource>();
  private occasionals = new Map<string, { config: Occasional; timer: NodeJS.Timeout }>();

  constructor(private mixer: Mixer, readonly dir: string) {
    super();
  }

  files(): string[] {
    fs.mkdirSync(this.dir, { recursive: true });
    return fs
      .readdirSync(this.dir)
      .filter((f) => AUDIO_EXT.has(path.extname(f).toLowerCase()))
      .sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true }));
  }

  /** Liga ou desliga uma camada. Sem `on`, alterna. */
  toggle(arquivo: string, on?: boolean, fadeMs = 1500) {
    const ativa = this.layers.has(arquivo);
    if (on ?? !ativa) this.startLayer(arquivo, 0.8, fadeMs);
    else this.stopLayer(arquivo, fadeMs);
    this.changed();
  }

  setLayerVolume(arquivo: string, volume: number) {
    const source = this.layers.get(arquivo);
    if (source) source.volume = clamp(volume);
    this.changed();
  }

  /** Troca o conjunto de camadas (usado pelas cenas): some com as que saem, entra com as novas. */
  setLayers(camadas: Layer[], fadeMs: number) {
    const novas = new Map(camadas.map((c) => [c.arquivo, c.volume]));
    for (const arquivo of [...this.layers.keys()]) if (!novas.has(arquivo)) this.stopLayer(arquivo, fadeMs);
    for (const [arquivo, volume] of novas) {
      const atual = this.layers.get(arquivo);
      if (atual) atual.volume = clamp(volume);
      else this.startLayer(arquivo, volume, fadeMs);
    }
    this.changed();
  }

  addOccasional(config: Omit<Occasional, 'id'> & { id?: string }) {
    const id = config.id ?? Math.random().toString(36).slice(2, 10);
    const full: Occasional = {
      id,
      arquivos: config.arquivos.filter(Boolean),
      min: Math.max(1, config.min),
      max: Math.max(config.min, config.max),
      volume: clamp(config.volume),
    };
    if (full.arquivos.length === 0) return;
    this.removeOccasional(id);
    this.occasionals.set(id, { config: full, timer: this.schedule(full) });
    this.changed();
  }

  removeOccasional(id: string) {
    const item = this.occasionals.get(id);
    if (!item) return;
    clearTimeout(item.timer);
    this.occasionals.delete(id);
    this.changed();
  }

  setOccasionals(lista: Occasional[]) {
    for (const id of [...this.occasionals.keys()]) this.removeOccasional(id);
    for (const item of lista) this.addOccasional(item);
    this.changed();
  }

  stopAll(fadeMs: number) {
    this.setLayers([], fadeMs);
    this.setOccasionals([]);
  }

  state(): AmbienceState {
    return {
      arquivos: this.files(),
      camadas: [...this.layers].map(([arquivo, source]) => ({ arquivo, volume: source.volume })),
      ocasionais: [...this.occasionals.values()].map((o) => o.config),
    };
  }

  private startLayer(arquivo: string, volume: number, fadeMs: number) {
    const file = path.join(this.dir, path.basename(arquivo));
    if (!fs.existsSync(file) || this.layers.has(arquivo)) return;
    const source = new FileSource(file, 'ambiente', false, true);
    source.volume = clamp(volume);
    this.layers.set(arquivo, source);
    this.mixer.fadeIn(source, fadeMs);
  }

  private stopLayer(arquivo: string, fadeMs: number) {
    const source = this.layers.get(arquivo);
    if (!source) return;
    this.layers.delete(arquivo);
    this.mixer.fadeOut(source, fadeMs);
  }

  private schedule(config: Occasional): NodeJS.Timeout {
    const delay = (config.min + Math.random() * (config.max - config.min)) * 1000;
    return setTimeout(() => {
      const item = this.occasionals.get(config.id);
      if (!item) return;
      const arquivo = config.arquivos[Math.floor(Math.random() * config.arquivos.length)];
      const file = path.join(this.dir, path.basename(arquivo));
      if (fs.existsSync(file)) {
        const source = new FileSource(file, 'ambiente');
        // Pequena variação de volume para o mesmo som não soar sempre igual.
        source.volume = clamp(config.volume * (0.75 + Math.random() * 0.25));
        this.mixer.add(source);
      }
      item.timer = this.schedule(config);
    }, delay);
  }

  private changed() {
    this.emit('change', this.state());
  }
}

function clamp(v: number) {
  return Math.min(1, Math.max(0, Number(v) || 0));
}
