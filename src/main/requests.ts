import { EventEmitter } from 'node:events';
import type { Player } from './discord';

// Pedidos dos jogadores (/musica e /som): ficam numa fila até o mestre aprovar ou recusar.

export interface PlayerRequest {
  id: string;
  tipo: 'musica' | 'som';
  jogador: Player;
  valor: string;
  em: number;
}

const MAX_POR_JOGADOR = 3;

/** Emite 'change' (lista), 'novo' (pedido recém-chegado) e 'aprovado' (pedido a executar). */
export class Requests extends EventEmitter {
  private lista: PlayerRequest[] = [];

  constructor(public aceitando = true) {
    super();
  }

  add(tipo: PlayerRequest['tipo'], jogador: Player, valor: string): { ok: boolean; mensagem: string } {
    if (!this.aceitando) return { ok: false, mensagem: 'O mestre não está aceitando pedidos agora.' };
    if (this.lista.filter((p) => p.jogador.id === jogador.id).length >= MAX_POR_JOGADOR) {
      return { ok: false, mensagem: `Você já tem ${MAX_POR_JOGADOR} pedidos esperando o mestre.` };
    }
    const pedido: PlayerRequest = { id: Math.random().toString(36).slice(2, 10), tipo, jogador, valor: valor.trim(), em: Date.now() };
    this.lista.push(pedido);
    this.emit('novo', pedido);
    this.changed();
    return { ok: true, mensagem: tipo === 'musica' ? `🎵 **${jogador.nome}** pediu uma música ao mestre.` : `🔊 **${jogador.nome}** pediu o som **${pedido.valor}**.` };
  }

  approve(id: string) {
    const pedido = this.take(id);
    if (pedido) this.emit('aprovado', pedido);
  }

  reject(id: string) {
    this.take(id);
  }

  setAccepting(sim: boolean) {
    this.aceitando = sim;
    this.changed();
  }

  state() {
    return { aceitando: this.aceitando, pedidos: this.lista };
  }

  private take(id: string) {
    const i = this.lista.findIndex((p) => p.id === id);
    if (i < 0) return undefined;
    const [pedido] = this.lista.splice(i, 1);
    this.changed();
    return pedido;
  }

  private changed() {
    this.emit('change', this.state());
  }
}
