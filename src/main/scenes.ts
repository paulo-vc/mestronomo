import { EventEmitter } from 'node:events';
import type { Ambience, Layer, Occasional } from './ambience';
import type { YouTubePlayer } from './youtube';
import type { TrackInfo } from './sources';

/** O que a cena faz com a música do YouTube. */
export type SceneMusic = { modo: 'manter' } | { modo: 'parar' } | { modo: 'youtube'; fila: TrackInfo[]; atual: number };

export interface Scene {
  id: string;
  nome: string;
  camadas: Layer[];
  ocasionais: Occasional[];
  musica: SceneMusic;
}

export interface ScenesState {
  cenas: { id: string; nome: string; resumo: string }[];
  ativa?: string;
  /** Duração do crossfade entre cenas, em ms. */
  fadeMs: number;
}

/**
 * Cenas: um clique troca ambiente, sons ocasionais e música, tudo com crossfade.
 * As cenas são salvas pelo main (config.json) via o evento 'save'. Emite 'change' com o estado.
 */
export class SceneManager extends EventEmitter {
  private ativa: string | undefined;

  constructor(
    private ambience: Ambience,
    private youtube: YouTubePlayer,
    private cenas: Scene[] = [],
    public fadeMs = 3000,
  ) {
    super();
  }

  /** Guarda o que está tocando agora como uma cena nova (ou substitui uma de mesmo nome). */
  saveCurrent(nome: string, musica: SceneMusic['modo']) {
    const amb = this.ambience.state();
    const yt = this.youtube.state();
    const cena: Scene = {
      id: this.cenas.find((c) => c.nome === nome)?.id ?? Math.random().toString(36).slice(2, 10),
      nome: nome.trim() || `Cena ${this.cenas.length + 1}`,
      camadas: amb.camadas,
      ocasionais: amb.ocasionais,
      musica: musica === 'youtube' && yt.fila.length ? { modo: 'youtube', fila: yt.fila, atual: Math.max(0, yt.atual) } : { modo: musica === 'parar' ? 'parar' : 'manter' },
    };
    const i = this.cenas.findIndex((c) => c.id === cena.id);
    if (i >= 0) this.cenas[i] = cena;
    else this.cenas.push(cena);
    this.ativa = cena.id;
    this.persist();
  }

  /** Ativa por id, nome (sem diferenciar maiúsculas) ou posição (começando em 1). */
  activate(ref: string) {
    const cena = this.find(ref);
    if (!cena) return false;
    this.ambience.setLayers(cena.camadas, this.fadeMs);
    this.ambience.setOccasionals(cena.ocasionais);
    if (cena.musica.modo === 'parar') this.youtube.stop(this.fadeMs);
    if (cena.musica.modo === 'youtube') this.youtube.replaceQueue(cena.musica.fila, cena.musica.atual, this.fadeMs);
    this.ativa = cena.id;
    this.changed();
    return true;
  }

  remove(id: string) {
    this.cenas = this.cenas.filter((c) => c.id !== id);
    if (this.ativa === id) this.ativa = undefined;
    this.persist();
  }

  setFade(ms: number) {
    this.fadeMs = Math.min(15000, Math.max(0, ms));
    this.persist();
  }

  find(ref: string) {
    const lower = ref.toLowerCase();
    if (/^\d+$/.test(ref)) return this.cenas[Number(ref) - 1];
    return this.cenas.find((c) => c.id === ref || c.nome.toLowerCase() === lower);
  }

  list() {
    return this.cenas;
  }

  state(): ScenesState {
    return {
      cenas: this.cenas.map((c) => ({ id: c.id, nome: c.nome, resumo: summary(c) })),
      ativa: this.ativa,
      fadeMs: this.fadeMs,
    };
  }

  private persist() {
    this.emit('save', this.cenas, this.fadeMs);
    this.changed();
  }

  private changed() {
    this.emit('change', this.state());
  }
}

function summary(cena: Scene) {
  const partes = [];
  if (cena.camadas.length) partes.push(`${cena.camadas.length} camada${cena.camadas.length > 1 ? 's' : ''}`);
  if (cena.ocasionais.length) partes.push(`${cena.ocasionais.length} ocasional${cena.ocasionais.length > 1 ? 'is' : ''}`);
  if (cena.musica.modo === 'youtube') partes.push(`YouTube: ${cena.musica.fila[cena.musica.atual]?.title ?? ''}`);
  if (cena.musica.modo === 'parar') partes.push('sem música');
  return partes.join(' · ') || 'silêncio';
}
