import { EventEmitter } from 'node:events';

export interface TimerState {
  id: string;
  nome: string;
  /** Duração total, em segundos. */
  total: number;
  /** Quando acaba (epoch ms); ausente quando pausado. */
  fim?: number;
  /** Segundos que faltavam quando foi pausado. */
  restante?: number;
  /** Som da soundboard (id) tocado ao acabar. */
  som?: string;
}

/** Contagens regressivas ("a tocha apaga em 10 min"). Emite 'change' e 'fim' com o timer que acabou. */
export class Timers extends EventEmitter {
  private timers = new Map<string, { state: TimerState; handle?: NodeJS.Timeout }>();

  add(nome: string, segundos: number, som?: string) {
    if (!(segundos > 0)) return;
    const id = Math.random().toString(36).slice(2, 10);
    const state: TimerState = { id, nome: nome.trim() || 'Timer', total: segundos, som: som || undefined };
    this.timers.set(id, { state });
    this.run(id, segundos);
  }

  togglePause(id: string) {
    const t = this.timers.get(id);
    if (!t) return;
    if (t.state.fim) {
      clearTimeout(t.handle);
      t.state.restante = Math.max(0, (t.state.fim - Date.now()) / 1000);
      t.state.fim = undefined;
      this.changed();
    } else {
      this.run(id, t.state.restante ?? t.state.total);
    }
  }

  remove(id: string) {
    clearTimeout(this.timers.get(id)?.handle);
    this.timers.delete(id);
    this.changed();
  }

  state(): TimerState[] {
    return [...this.timers.values()].map((t) => t.state);
  }

  private run(id: string, segundos: number) {
    const t = this.timers.get(id)!;
    t.state.fim = Date.now() + segundos * 1000;
    t.state.restante = undefined;
    t.handle = setTimeout(() => {
      this.timers.delete(id);
      this.emit('fim', t.state);
      this.changed();
    }, segundos * 1000);
    this.changed();
  }

  private changed() {
    this.emit('change', this.state());
  }
}
