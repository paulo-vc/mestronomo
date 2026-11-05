import { EventEmitter } from 'node:events';
import type { Mixer, Source } from './mixer';
import { FileSource, NORMALIZE_MUSIC, StreamSource, isSingleVideo, resolveTracks, searchTracks, type FfmpegSource, type TrackInfo } from './sources';

export type LoopMode = 'nenhum' | 'fila' | 'faixa';

export interface YouTubeState {
  fila: TrackInfo[];
  atual: number;
  pausado: boolean;
  /** Segundos tocados da faixa atual. */
  posicao: number;
  volume: number;
  repetir: LoopMode;
  carregando: boolean;
  aleatorio: boolean;
  /** Duração do crossfade entre faixas, em ms (0 = sem crossfade). */
  crossfadeMs: number;
  normalizar: boolean;
}

/** Quanto antes do crossfade a próxima faixa começa a carregar (o YouTube leva ~4 s para começar). */
const PRELOAD_STREAM_S = 7;
/** Quantas faixas recentes o modo aleatório evita repetir. */
const RECENTES = 5;

/**
 * Player de música: uma fila que mistura links (YouTube e outros sites do yt-dlp) e arquivos locais,
 * tocando pelo bus de música. Emite 'change' e 'erro'.
 */
export class YouTubePlayer extends EventEmitter {
  queue: TrackInfo[] = [];
  current = -1;
  loop: LoopMode = 'nenhum';
  volume = 0.8;
  shuffle = false;
  crossfadeMs = 4000;
  normalize = true;
  private source: FfmpegSource | undefined;
  /** Próxima faixa já carregando (pausada, fora do mixer) para entrar no crossfade. */
  private prepared: { index: number; source: FfmpegSource } | undefined;
  /** Faixas tocadas, na ordem: o ⏮ volta por aqui (importa no modo aleatório). */
  private history: number[] = [];
  private loading = 0;
  private failures = 0;

  constructor(private mixer: Mixer) {
    super();
    mixer.on('ended', (source: Source) => {
      if (source === this.source) this.onTrackEnd(this.source);
    });
    setInterval(() => this.checkCrossfade(), 250).unref();
  }

  /** Adiciona um link (vídeo ou playlist). Começa a tocar se nada estiver tocando. */
  async add(url: string) {
    // Vídeo único com o player parado: começa já, e o título chega depois (economiza ~2 s).
    let placeholder: TrackInfo | undefined;
    if (isSingleVideo(url) && !this.source) {
      placeholder = { url, title: 'Carregando…' };
      this.queue.push(placeholder);
      this.play(this.queue.length - 1);
    }
    this.loading++;
    this.changed();
    try {
      const tracks = await resolveTracks(url);
      if (tracks.length === 0) throw new Error('nenhuma faixa encontrada');
      if (placeholder) Object.assign(placeholder, tracks[0]);
      else this.addTracks(tracks);
    } catch (err) {
      if (placeholder) this.remove(this.queue.indexOf(placeholder));
      this.emit('erro', `Não consegui abrir o link: ${errorDetail(err)}`);
    } finally {
      this.loading--;
      this.changed();
    }
  }

  /** Coloca faixas no fim da fila (ex.: uma pasta de músicas locais). */
  addTracks(tracks: TrackInfo[]) {
    if (tracks.length === 0) return;
    const first = this.queue.length;
    this.queue.push(...tracks);
    if (!this.source) this.play(first);
    else this.changed();
  }

  /** Busca no YouTube; não mexe na fila. */
  async search(query: string): Promise<TrackInfo[]> {
    this.loading++;
    this.changed();
    try {
      return await searchTracks(query);
    } catch (err) {
      this.emit('erro', `A busca falhou: ${errorDetail(err)}`);
      return [];
    } finally {
      this.loading--;
      this.changed();
    }
  }

  /** Com `fadeMs`, a faixa atual sai e a nova entra suavemente (cenas e crossfade entre faixas). */
  play(index: number, fadeMs = 0, registrar = true) {
    this.stopSource(fadeMs);
    if (index < 0 || index >= this.queue.length) {
      this.discardPrepared();
      this.current = -1;
      return this.changed();
    }
    if (registrar && this.current >= 0 && this.current !== index) this.history.push(this.current);
    this.current = index;
    // A próxima faixa já pode estar carregada (crossfade); senão, cria agora.
    let source = this.prepared?.index === index ? this.prepared.source : undefined;
    if (source) this.prepared = undefined;
    else {
      this.discardPrepared();
      source = this.createSource(index);
    }
    source.paused = false;
    source.volume = this.volume;
    this.source = source;
    this.mixer.fadeIn(source, fadeMs);
    this.changed();
  }

  /** Troca a fila inteira de uma vez (cenas), com crossfade da faixa atual para a nova. */
  replaceQueue(tracks: TrackInfo[], start: number, fadeMs: number) {
    this.discardPrepared();
    this.history = [];
    this.queue = [...tracks];
    this.play(Math.min(Math.max(0, start), tracks.length - 1), fadeMs);
  }

  next(fadeMs = 0) {
    this.play(this.nextIndex(), fadeMs);
  }

  /** Como nos players comuns: depois de 3 s volta ao começo da faixa; antes disso, vai para a anterior. */
  previous() {
    if (this.source && this.source.seconds > 3) return this.play(this.current, 0, false);
    const anterior = this.history.pop();
    this.play(anterior ?? Math.max(0, this.current - 1), 0, false);
  }

  setShuffle(sim: boolean) {
    this.shuffle = sim;
    this.discardPrepared();
    this.changed();
  }

  setCrossfade(ms: number) {
    this.crossfadeMs = Math.min(12000, Math.max(0, ms));
    this.changed();
  }

  /** Vale a partir da próxima faixa (a atual já está tocando com ou sem o filtro). */
  setNormalize(sim: boolean) {
    this.normalize = sim;
    this.discardPrepared();
    this.changed();
  }

  togglePause() {
    if (!this.source) return this.play(this.current >= 0 ? this.current : 0);
    this.source.paused = !this.source.paused;
    this.changed();
  }

  stop(fadeMs = 0) {
    this.stopSource(fadeMs);
    this.changed();
  }

  remove(index: number) {
    if (index < 0 || index >= this.queue.length) return;
    this.discardPrepared();
    this.queue.splice(index, 1);
    this.history = this.history.filter((i) => i !== index).map((i) => (i > index ? i - 1 : i));
    if (index === this.current) {
      this.play(index < this.queue.length ? index : -1);
      return;
    }
    if (index < this.current) this.current--;
    this.changed();
  }

  clear() {
    this.stopSource();
    this.discardPrepared();
    this.history = [];
    this.queue = [];
    this.current = -1;
    this.changed();
  }

  setVolume(volume: number) {
    this.volume = Math.min(1, Math.max(0, volume));
    if (this.source) this.source.volume = this.volume;
    this.changed();
  }

  setLoop(mode: LoopMode) {
    this.loop = mode;
    this.changed();
  }

  state(): YouTubeState {
    return {
      fila: this.queue,
      atual: this.current,
      pausado: this.source?.paused ?? true,
      posicao: this.source?.seconds ?? 0,
      volume: this.volume,
      repetir: this.loop,
      carregando: this.loading > 0,
      aleatorio: this.shuffle,
      crossfadeMs: this.crossfadeMs,
      normalizar: this.normalize,
    };
  }

  /** Próxima faixa: em ordem, ou sorteada evitando as recentes; -1 quando a fila acaba. */
  nextIndex(random: () => number = Math.random): number {
    const n = this.queue.length;
    if (n === 0) return -1;
    if (!this.shuffle) {
      const next = this.current + 1;
      return next < n ? next : this.loop === 'fila' ? 0 : -1;
    }
    if (n === 1) return this.loop === 'fila' ? 0 : -1;
    const recentes = new Set([this.current, ...this.history.slice(-Math.min(RECENTES, n - 2))]);
    const opcoes = [...Array(n).keys()].filter((i) => !recentes.has(i));
    return opcoes[Math.floor(random() * opcoes.length)] ?? (this.current + 1) % n;
  }

  private createSource(index: number): FfmpegSource {
    const track = this.queue[index];
    const filtro = this.normalize ? NORMALIZE_MUSIC : undefined;
    return track.local ? new FileSource(track.url, 'musica', false, false, filtro) : new StreamSource(track.url, 'musica', filtro);
  }

  /**
   * Crossfade entre faixas: perto do fim, carrega a próxima (pausada, fora do mixer, enchendo
   * o buffer) e, no ponto do crossfade, solta ela com fade-in enquanto a atual sai com fade-out.
   */
  private checkCrossfade() {
    const source = this.source;
    const track = this.queue[this.current];
    if (!source || source.paused || !track?.duration || this.crossfadeMs <= 0 || this.loop === 'faixa') return;
    const restante = track.duration - source.seconds;
    const xf = this.crossfadeMs / 1000;
    if (!this.prepared && restante <= xf + (track.local ? 1 : PRELOAD_STREAM_S)) {
      const index = this.nextIndex();
      if (index < 0) return;
      const preparado = this.createSource(index);
      preparado.paused = true;
      this.prepared = { index, source: preparado };
    }
    if (this.prepared && restante <= xf) this.play(this.prepared.index, this.crossfadeMs);
  }

  private discardPrepared() {
    this.prepared?.source.stop();
    this.prepared = undefined;
  }

  private onTrackEnd(source: FfmpegSource) {
    this.source = undefined;
    if (source.framesPlayed === 0) {
      // Nada tocou: vídeo indisponível ou bloqueado. Pula, mas sem girar para sempre numa fila toda quebrada.
      this.emit('erro', `Não consegui tocar "${this.queue[this.current]?.title}". Pulando.`);
      if (this.loop === 'faixa' || ++this.failures >= this.queue.length) {
        this.failures = 0;
        return this.stop();
      }
      return this.next();
    }
    this.failures = 0;
    if (this.loop === 'faixa') this.play(this.current, 0, false);
    // Se a próxima já estava preparada (faixa acabou antes do previsto), ela é aproveitada.
    else this.play(this.prepared?.index ?? this.nextIndex());
  }

  private stopSource(fadeMs = 0) {
    if (!this.source) return;
    const old = this.source;
    this.source = undefined;
    this.mixer.fadeOut(old, fadeMs);
  }

  private changed() {
    this.emit('change', this.state());
  }
}

function errorDetail(err: unknown) {
  return (err as { stderr?: string }).stderr?.match(/ERROR: (.+)/)?.[1] ?? (err as Error).message;
}
