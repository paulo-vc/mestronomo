import { EventEmitter } from 'node:events';
import type { Mixer, Source } from './mixer';
import { FileSource, StreamSource, isSingleVideo, resolveTracks, searchTracks, type FfmpegSource, type TrackInfo } from './sources';

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
}

/**
 * Player de música: uma fila que mistura links (YouTube e outros sites do yt-dlp) e arquivos locais,
 * tocando pelo bus de música. Emite 'change' e 'erro'.
 */
export class YouTubePlayer extends EventEmitter {
  queue: TrackInfo[] = [];
  current = -1;
  loop: LoopMode = 'nenhum';
  volume = 0.8;
  private source: FfmpegSource | undefined;
  private loading = 0;
  private failures = 0;

  constructor(private mixer: Mixer) {
    super();
    mixer.on('ended', (source: Source) => {
      if (source === this.source) this.onTrackEnd(this.source);
    });
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

  /** Com `fadeMs`, a faixa atual sai e a nova entra suavemente (usado pelas cenas). */
  play(index: number, fadeMs = 0) {
    this.stopSource(fadeMs);
    if (index < 0 || index >= this.queue.length) {
      this.current = -1;
      return this.changed();
    }
    this.current = index;
    const track = this.queue[index];
    const source = track.local ? new FileSource(track.url, 'musica') : new StreamSource(track.url);
    source.volume = this.volume;
    this.source = source;
    this.mixer.fadeIn(source, fadeMs);
    this.changed();
  }

  /** Troca a fila inteira de uma vez (cenas), com crossfade da faixa atual para a nova. */
  replaceQueue(tracks: TrackInfo[], start: number, fadeMs: number) {
    this.queue = [...tracks];
    this.play(Math.min(Math.max(0, start), tracks.length - 1), fadeMs);
  }

  next() {
    const next = this.current + 1;
    this.play(next < this.queue.length ? next : this.loop === 'fila' ? 0 : -1);
  }

  /** Como nos players comuns: depois de 3 s volta ao começo da faixa; antes disso, vai para a anterior. */
  previous() {
    if (this.source && this.source.seconds > 3) this.play(this.current);
    else this.play(Math.max(0, this.current - 1));
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
    this.queue.splice(index, 1);
    if (index === this.current) {
      this.play(index < this.queue.length ? index : -1);
      return;
    }
    if (index < this.current) this.current--;
    this.changed();
  }

  clear() {
    this.stopSource();
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
    };
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
    if (this.loop === 'faixa') this.play(this.current);
    else this.next();
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
