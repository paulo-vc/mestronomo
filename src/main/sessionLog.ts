import { EventEmitter } from 'node:events';

// Registro da sessão: o que marcou a noite (cenas, momentos, combates, críticos, músicas,
// pedidos), para o resumo postado no Discord. Sobrevive a reiniciar o app.

export type LogKind = 'cena' | 'momento' | 'combate' | 'critico' | 'falha' | 'musica' | 'pedido';

export interface LogEntry {
  em: number;
  tipo: LogKind;
  texto: string;
}

export interface SessionLogState {
  inicio: number;
  eventos: LogEntry[];
}

const ICONES: Record<LogKind, string> = {
  cena: '🎬',
  momento: '📜',
  combate: '⚔️',
  critico: '✨',
  falha: '💀',
  musica: '🎵',
  pedido: '📨',
};
const MAX_EVENTOS = 500;

/** Emite 'change' com o estado (para a tela e para o config.json). */
export class SessionLog extends EventEmitter {
  private s: SessionLogState;

  constructor(saved?: SessionLogState) {
    super();
    this.s = saved ?? { inicio: Date.now(), eventos: [] };
  }

  add(tipo: LogKind, texto: string) {
    const ultimo = this.s.eventos[this.s.eventos.length - 1];
    // A mesma música/cena repetida em seguida não vale duas linhas.
    if (ultimo && ultimo.tipo === tipo && ultimo.texto === texto) return;
    this.s.eventos.push({ em: Date.now(), tipo, texto });
    if (this.s.eventos.length > MAX_EVENTOS) this.s.eventos.shift();
    this.changed();
  }

  reset() {
    this.s = { inicio: Date.now(), eventos: [] };
    this.changed();
  }

  state() {
    return this.s;
  }

  summary(agora = Date.now()) {
    const conta = (tipo: LogKind) => this.s.eventos.filter((e) => e.tipo === tipo).length;
    const duracao = Math.max(0, agora - this.s.inicio);
    const h = Math.floor(duracao / 3_600_000);
    const m = Math.round((duracao % 3_600_000) / 60_000);
    const data = new Date(this.s.inicio).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
    const titulo = `📖 Resumo da sessão — ${data} (${h ? `${h} h ` : ''}${m} min)`;

    const numeros = [
      [conta('cena'), 'cena', 'cenas'],
      // Cada combate registra início e fim; conta só os inícios.
      [this.s.eventos.filter((e) => e.tipo === 'combate' && e.texto.startsWith('Combate começou')).length, 'combate', 'combates'],
      [conta('critico'), 'crítico', 'críticos'],
      [conta('falha'), 'falha crítica', 'falhas críticas'],
      [conta('musica'), 'música', 'músicas'],
    ]
      .filter(([n]) => (n as number) > 0)
      .map(([n, um, varios]) => `**${n}** ${n === 1 ? um : varios}`);

    const linhas = [numeros.join(' · ') || 'Uma sessão tranquila.', ''];
    for (const e of this.s.eventos) {
      const hora = new Date(e.em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      linhas.push(`\`${hora}\` ${ICONES[e.tipo]} ${e.texto}`);
    }
    return { titulo, linhas };
  }

  private changed() {
    this.emit('change', this.s);
  }
}
