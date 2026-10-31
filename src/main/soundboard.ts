import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import type { Mixer } from './mixer';
import { FileSource } from './sources';
import { AUDIO_EXT } from './ambience';

/** Ajustes de um som, guardados no config.json. */
export interface SoundOptions {
  volume: number;
  loop: boolean;
  cor?: string;
}

/** Um botão da soundboard: um ou mais arquivos (variações sorteadas) de uma categoria. */
export interface SoundGroup extends SoundOptions {
  /** "Categoria/nome", ou só "nome" na raiz da pasta. */
  id: string;
  nome: string;
  categoria: string;
  arquivos: string[];
}

export interface SoundboardState {
  categorias: string[];
  sons: SoundGroup[];
  /** Ids dos sons em loop tocando agora. */
  loops: string[];
}

const ROOT_CATEGORY = 'Geral';
const DEFAULTS: SoundOptions = { volume: 1, loop: false };

/** Tira a extensão e o número de ordem do começo: "01 espada 2.mp3" → "espada 2". */
const baseName = (file: string) => path.basename(file).replace(/\.[^.]+$/, '').replace(/^\d+[\s._-]+/, '');
/** Tira o número de variação do fim: "espada 2" / "espada (2)" / "espada_2" → "espada". "d20" continua "d20". */
const groupName = (file: string) => baseName(file).replace(/(?:[\s._-]+\(?\d+\)?|\s*\(\d+\))$/, '') || baseName(file);

/**
 * Soundboard: subpastas viram categorias e arquivos com o mesmo nome e um número no fim
 * viram um só botão que sorteia entre eles. Emite 'change' com o estado.
 */
export class Soundboard extends EventEmitter {
  private loops = new Map<string, FileSource>();
  private last = new Map<string, string>();

  constructor(
    private mixer: Mixer,
    readonly dir: string,
    private options: Record<string, SoundOptions> = {},
  ) {
    super();
  }

  list(): SoundGroup[] {
    fs.mkdirSync(this.dir, { recursive: true });
    const groups = new Map<string, SoundGroup>();
    const add = (categoria: string, relative: string) => {
      const nome = groupName(relative);
      const id = categoria === ROOT_CATEGORY ? nome : `${categoria}/${nome}`;
      const group = groups.get(id) ?? { id, nome, categoria, arquivos: [], ...DEFAULTS, ...this.options[id] };
      group.arquivos.push(relative);
      groups.set(id, group);
    };
    for (const entry of fs.readdirSync(this.dir, { withFileTypes: true })) {
      if (entry.isFile() && isAudio(entry.name)) add(ROOT_CATEGORY, entry.name);
      if (entry.isDirectory()) {
        for (const file of fs.readdirSync(path.join(this.dir, entry.name))) {
          if (isAudio(file)) add(entry.name, `${entry.name}/${file}`);
        }
      }
    }
    // Ordem: categoria, depois o nome do primeiro arquivo (respeita prefixos "01 ", "02 "...).
    return [...groups.values()].sort(
      (a, b) =>
        Number(a.categoria !== ROOT_CATEGORY) - Number(b.categoria !== ROOT_CATEGORY) ||
        a.categoria.localeCompare(b.categoria, 'pt-BR') ||
        path.basename(a.arquivos[0]).localeCompare(path.basename(b.arquivos[0]), 'pt-BR', { numeric: true }),
    );
  }

  /** Acha um som pelo id, pelo nome (sem diferenciar maiúsculas), pelo arquivo ou pela posição (1 = primeiro). */
  find(ref: string): SoundGroup | undefined {
    const sons = this.list();
    if (/^\d+$/.test(ref)) return sons[Number(ref) - 1];
    const lower = ref.toLowerCase();
    return (
      sons.find((s) => s.id.toLowerCase() === lower) ??
      sons.find((s) => s.nome.toLowerCase() === lower) ??
      sons.find((s) => s.arquivos.some((a) => a === ref || path.basename(a) === ref))
    );
  }

  /** Toca um som. Em loop, alterna: o segundo clique para. Com `preview`, toca só no fone do mestre. */
  play(ref: string, preview = false) {
    const som = this.find(ref);
    if (!som) return false;
    if (som.loop && !preview) {
      const atual = this.loops.get(som.id);
      if (atual) {
        this.loops.delete(som.id);
        this.mixer.fadeOut(atual, 300);
      } else {
        const source = this.source(som, false, true);
        this.loops.set(som.id, source);
        this.mixer.fadeIn(source, 300);
      }
      this.changed();
      return true;
    }
    this.mixer.add(this.source(som, preview, false));
    return true;
  }

  stopAll() {
    this.mixer.stopBus('efeitos');
    this.loops.clear();
    this.changed();
  }

  setOptions(id: string, changes: Partial<SoundOptions>) {
    const atual = { ...DEFAULTS, ...this.options[id], ...changes };
    atual.volume = Math.min(1, Math.max(0, atual.volume));
    this.options[id] = atual;
    const loop = this.loops.get(id);
    if (loop) {
      loop.volume = atual.volume;
      // Deixou de ser loop: para o que estava tocando.
      if (!atual.loop) {
        this.loops.delete(id);
        this.mixer.fadeOut(loop, 300);
      }
    }
    this.emit('options', this.options);
    this.changed();
  }

  state(): SoundboardState {
    const sons = this.list();
    return {
      categorias: [...new Set(sons.map((s) => s.categoria))],
      sons,
      loops: [...this.loops.keys()],
    };
  }

  private source(som: SoundGroup, preview: boolean, loop: boolean) {
    const file = path.join(this.dir, this.pick(som));
    const source = new FileSource(file, 'efeitos', preview, loop);
    source.volume = som.volume;
    // Loops (batida de coração, sino ao fundo...) não abaixam a música o tempo todo.
    if (loop) source.ducks = false;
    return source;
  }

  /** Sorteia uma variação, evitando repetir a última quando há mais de uma. */
  private pick(som: SoundGroup) {
    const opcoes = som.arquivos.length > 1 ? som.arquivos.filter((a) => a !== this.last.get(som.id)) : som.arquivos;
    const escolhido = opcoes[Math.floor(Math.random() * opcoes.length)];
    this.last.set(som.id, escolhido);
    return escolhido;
  }

  private changed() {
    this.emit('change', this.state());
  }
}

function isAudio(file: string) {
  return AUDIO_EXT.has(path.extname(file).toLowerCase());
}
