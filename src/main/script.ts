import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';

// Roteiro da sessão: uma sequência de momentos preparados antes do jogo. Avançar para um
// momento ativa a cena dele e deixa à mão as notas, os sons e o handout daquele trecho.

export interface Moment {
  id: string;
  titulo: string;
  notas: string;
  /** Cena ativada ao entrar no momento. */
  cena?: string;
  /** Sons da soundboard (ids) mostrados como atalhos neste momento. */
  sons: string[];
  /** Imagem (dentro da pasta de handouts) e legenda para mandar no Discord. */
  handout?: { arquivo: string; legenda: string };
}

export interface Script {
  id: string;
  nome: string;
  momentos: Moment[];
}

export interface ScriptState {
  roteiros: Script[];
  ativo?: string;
  /** Índice do momento atual no roteiro ativo; -1 antes de começar. */
  indice: number;
}

const novoId = () => Math.random().toString(36).slice(2, 10);

/** Emite 'change' (estado), 'save' (para o config.json) e 'momento' (ao entrar num momento). */
export class Scripts extends EventEmitter {
  private s: ScriptState;

  constructor(saved: ScriptState | undefined, readonly handoutsDir: string) {
    super();
    this.s = saved ?? { roteiros: [], indice: -1 };
  }

  create(nome: string) {
    const roteiro: Script = { id: novoId(), nome: nome.trim() || `Sessão ${this.s.roteiros.length + 1}`, momentos: [] };
    this.s.roteiros.push(roteiro);
    this.s.ativo = roteiro.id;
    this.s.indice = -1;
    this.persist();
    return roteiro.id;
  }

  rename(id: string, nome: string) {
    const r = this.get(id);
    if (r && nome.trim()) r.nome = nome.trim();
    this.persist();
  }

  remove(id: string) {
    this.s.roteiros = this.s.roteiros.filter((r) => r.id !== id);
    if (this.s.ativo === id) {
      this.s.ativo = this.s.roteiros[0]?.id;
      this.s.indice = -1;
    }
    this.persist();
  }

  select(id: string) {
    if (!this.get(id)) return;
    this.s.ativo = id;
    this.s.indice = -1;
    this.persist();
  }

  /** Cria ou atualiza um momento do roteiro ativo. Sem id, entra no fim (ou depois de `depoisDe`). */
  saveMoment(momento: Partial<Moment> & { titulo: string }) {
    const r = this.active();
    if (!r) return;
    const dados: Moment = {
      id: momento.id || novoId(),
      titulo: momento.titulo.trim() || 'Sem título',
      notas: momento.notas ?? '',
      cena: momento.cena || undefined,
      sons: momento.sons ?? [],
      handout: momento.handout?.arquivo ? momento.handout : undefined,
    };
    const i = r.momentos.findIndex((m) => m.id === dados.id);
    if (i >= 0) r.momentos[i] = dados;
    else r.momentos.push(dados);
    this.persist();
  }

  removeMoment(id: string) {
    const r = this.active();
    if (!r) return;
    const i = r.momentos.findIndex((m) => m.id === id);
    if (i < 0) return;
    r.momentos.splice(i, 1);
    if (i <= this.s.indice) this.s.indice--;
    this.persist();
  }

  /** Move um momento uma posição para cima (-1) ou para baixo (+1). */
  moveMoment(id: string, delta: -1 | 1) {
    const r = this.active();
    if (!r) return;
    const i = r.momentos.findIndex((m) => m.id === id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= r.momentos.length) return;
    [r.momentos[i], r.momentos[j]] = [r.momentos[j], r.momentos[i]];
    if (this.s.indice === i) this.s.indice = j;
    else if (this.s.indice === j) this.s.indice = i;
    this.persist();
  }

  /** Copia a imagem para a pasta de handouts (vai junto no backup e na versão portátil). */
  importHandout(file: string) {
    fs.mkdirSync(this.handoutsDir, { recursive: true });
    const ext = path.extname(file).toLowerCase();
    const base = path.basename(file, path.extname(file)).replace(/[^\p{L}\p{N} _-]/gu, '').slice(0, 60) || 'handout';
    let nome = `${base}${ext}`;
    for (let n = 2; fs.existsSync(path.join(this.handoutsDir, nome)); n++) nome = `${base} ${n}${ext}`;
    fs.copyFileSync(file, path.join(this.handoutsDir, nome));
    return nome;
  }

  handoutPath(arquivo: string) {
    return path.join(this.handoutsDir, path.basename(arquivo));
  }

  goTo(indice: number) {
    const r = this.active();
    if (!r || indice < 0 || indice >= r.momentos.length) return;
    this.s.indice = indice;
    this.persist();
    this.emit('momento', r.momentos[indice]);
  }

  next() {
    this.goTo(this.s.indice + 1);
  }

  previous() {
    this.goTo(this.s.indice - 1);
  }

  current(): Moment | undefined {
    return this.active()?.momentos[this.s.indice];
  }

  state(): ScriptState {
    return this.s;
  }

  private active() {
    return this.s.ativo ? this.get(this.s.ativo) : undefined;
  }

  private get(id: string) {
    return this.s.roteiros.find((r) => r.id === id);
  }

  private persist() {
    this.emit('save', this.s);
    this.emit('change', this.s);
  }
}
