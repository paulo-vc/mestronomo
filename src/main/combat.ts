import { EventEmitter } from 'node:events';
import { roll } from './dice';

export interface Combatant {
  id: string;
  nome: string;
  iniciativa: number;
  hp?: number;
  hpMax?: number;
  /** Jogadores ficam destacados e não têm o HP mostrado no Discord. */
  jogador: boolean;
}

export interface CombatState {
  ativo: boolean;
  rodada: number;
  /** Índice de quem está agindo, na lista já ordenada. */
  turno: number;
  combatentes: Combatant[];
  /** Cena ativada ao começar o combate (id). */
  cenaCombate?: string;
}

export interface NewCombatant {
  nome: string;
  /** Número, ou vazio para rolar 1d20 + modificador. */
  iniciativa?: number;
  modificador?: number;
  hp?: number;
  jogador?: boolean;
}

/**
 * Tracker de iniciativa e HP. A lista fica sempre ordenada por iniciativa (maior primeiro).
 * Emite 'change' com o estado, 'inicio' e 'fim' (para as cenas) e 'turno' com quem age.
 */
export class Combat extends EventEmitter {
  private s: CombatState = { ativo: false, rodada: 0, turno: 0, combatentes: [] };

  constructor(saved?: CombatState) {
    super();
    if (saved) this.s = saved;
  }

  add(novo: NewCombatant) {
    const iniciativa = Number.isFinite(novo.iniciativa) ? Number(novo.iniciativa) : roll(`1d20+${novo.modificador ?? 0}`.replace('+-', '-')).total;
    const atual = this.s.combatentes[this.s.turno];
    this.s.combatentes.push({
      id: Math.random().toString(36).slice(2, 10),
      nome: novo.nome.trim() || 'Sem nome',
      iniciativa,
      hp: novo.hp,
      hpMax: novo.hp,
      jogador: Boolean(novo.jogador),
    });
    this.sort(atual?.id);
    this.changed();
  }

  remove(id: string) {
    const index = this.s.combatentes.findIndex((c) => c.id === id);
    if (index < 0) return;
    this.s.combatentes.splice(index, 1);
    if (index < this.s.turno) this.s.turno--;
    if (this.s.turno >= this.s.combatentes.length) this.s.turno = 0;
    this.changed();
  }

  /** "-7" causa dano, "+5" cura, "30" define o HP. */
  applyHp(id: string, entrada: string) {
    const c = this.s.combatentes.find((x) => x.id === id);
    const texto = entrada.trim();
    if (!c || !/^[+-]?\d+$/.test(texto)) return;
    const valor = Number(texto);
    const base = c.hp ?? 0;
    c.hp = /^[+-]/.test(texto) ? base + valor : valor;
    if (c.hpMax === undefined || c.hp > c.hpMax) c.hpMax = Math.max(c.hpMax ?? 0, c.hp);
    this.changed();
  }

  setInitiative(id: string, iniciativa: number) {
    const c = this.s.combatentes.find((x) => x.id === id);
    if (!c || !Number.isFinite(iniciativa)) return;
    const atual = this.s.combatentes[this.s.turno];
    c.iniciativa = iniciativa;
    this.sort(atual?.id);
    this.changed();
  }

  setCombatScene(id: string | undefined) {
    this.s.cenaCombate = id || undefined;
    this.changed();
  }

  start() {
    if (this.s.combatentes.length === 0) return;
    this.s.ativo = true;
    this.s.rodada = 1;
    this.s.turno = 0;
    this.emit('inicio', this.s.cenaCombate);
    this.changed();
    this.announce();
  }

  next() {
    if (!this.s.ativo || this.s.combatentes.length === 0) return;
    this.s.turno++;
    if (this.s.turno >= this.s.combatentes.length) {
      this.s.turno = 0;
      this.s.rodada++;
    }
    this.changed();
    this.announce();
  }

  previous() {
    if (!this.s.ativo || this.s.combatentes.length === 0) return;
    this.s.turno--;
    if (this.s.turno < 0) {
      this.s.turno = this.s.combatentes.length - 1;
      this.s.rodada = Math.max(1, this.s.rodada - 1);
    }
    this.changed();
  }

  end() {
    if (!this.s.ativo) return;
    this.s.ativo = false;
    this.s.rodada = 0;
    this.s.turno = 0;
    this.emit('fim');
    this.changed();
  }

  /** Tira os NPCs e mantém os jogadores para o próximo combate. */
  clearNpcs() {
    this.s.combatentes = this.s.combatentes.filter((c) => c.jogador);
    this.s.turno = 0;
    this.changed();
  }

  state(): CombatState {
    return this.s;
  }

  /** Ordena por iniciativa mantendo o turno em quem estava agindo. Empate: jogadores primeiro. */
  private sort(currentId?: string) {
    this.s.combatentes.sort((a, b) => b.iniciativa - a.iniciativa || Number(b.jogador) - Number(a.jogador));
    const index = this.s.combatentes.findIndex((c) => c.id === currentId);
    this.s.turno = index >= 0 ? index : 0;
  }

  private announce() {
    const c = this.s.combatentes[this.s.turno];
    if (c) this.emit('turno', c, this.s.rodada);
  }

  private changed() {
    this.emit('change', this.s);
  }
}
