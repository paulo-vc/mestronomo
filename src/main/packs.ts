import fs from 'node:fs';
import path from 'node:path';
import type { FilterSettings } from './dsp';
import type { Scene } from './scenes';

// Pacotes de sons que vêm com o app (pacotes/<id>/, montados por scripts/montar-pacotes.js).
// Instalar copia os efeitos para sons/<Nome>/<Categoria>/, os ambientes para
// ambientes/<Nome>/ e acrescenta as cenas de exemplo; remover desfaz tudo isso.

export interface PackInfo {
  id: string;
  nome: string;
  descricao: string;
  instalado: boolean;
  efeitos: number;
  ambientes: number;
}

interface PackManifest {
  id: string;
  nome: string;
  descricao: string;
  cenas: {
    nome: string;
    camadas: [string, number][];
    ocasionais?: { arquivos: string[]; min: number; max: number; volume: number }[];
    filtros?: Partial<FilterSettings>;
  }[];
}

export class Packs {
  constructor(
    private packsDir: string,
    private soundsDir: string,
    private ambientDir: string,
  ) {}

  list(): PackInfo[] {
    if (!fs.existsSync(this.packsDir)) return [];
    return fs
      .readdirSync(this.packsDir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && fs.existsSync(path.join(this.packsDir, e.name, 'pacote.json')))
      .map((e) => {
        const m = this.manifest(e.name);
        return {
          id: m.id,
          nome: m.nome,
          descricao: m.descricao,
          instalado: fs.existsSync(path.join(this.soundsDir, m.nome)) || fs.existsSync(path.join(this.ambientDir, m.nome)),
          efeitos: countFiles(path.join(this.packsDir, e.name, 'sons')),
          ambientes: countFiles(path.join(this.packsDir, e.name, 'ambientes')),
        };
      });
  }

  /** Copia os arquivos e devolve as cenas de exemplo, já apontando para ambientes/<Nome>/. */
  install(id: string): Omit<Scene, 'id'>[] {
    const m = this.manifest(id);
    const origem = path.join(this.packsDir, id);
    copyDir(path.join(origem, 'sons'), path.join(this.soundsDir, m.nome));
    copyDir(path.join(origem, 'ambientes'), path.join(this.ambientDir, m.nome));
    fs.copyFileSync(path.join(origem, 'CREDITOS.txt'), path.join(this.soundsDir, m.nome, 'CREDITOS.txt'));
    const arquivo = (nome: string) => `${m.nome}/${nome}.ogg`;
    return m.cenas.map((c) => ({
      nome: c.nome,
      pacote: m.id,
      camadas: c.camadas.map(([nome, volume]) => ({ arquivo: arquivo(nome), volume })),
      ocasionais: (c.ocasionais ?? []).map((o, i) => ({ ...o, id: `${m.id}-${i}`, arquivos: o.arquivos.map(arquivo) })),
      musica: { modo: 'manter' as const },
      filtros: { abafado: false, caverna: false, eco: false, ...c.filtros },
    }));
  }

  remove(id: string) {
    const m = this.manifest(id);
    // Um ffmpeg que acabou de ser encerrado pode segurar o arquivo por alguns instantes no
    // Windows (EPERM/EBUSY): o rmSync tenta de novo por até ~2 s.
    const opcoes = { recursive: true, force: true, maxRetries: 10, retryDelay: 200 };
    fs.rmSync(path.join(this.soundsDir, m.nome), opcoes);
    fs.rmSync(path.join(this.ambientDir, m.nome), opcoes);
  }

  private manifest(id: string): PackManifest {
    return JSON.parse(fs.readFileSync(path.join(this.packsDir, path.basename(id), 'pacote.json'), 'utf8'));
  }
}

function copyDir(from: string, to: string) {
  if (fs.existsSync(from)) fs.cpSync(from, to, { recursive: true });
}

function countFiles(dir: string): number {
  if (!fs.existsSync(dir)) return 0;
  return fs.readdirSync(dir, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? countFiles(path.join(dir, e.name)) : e.name.endsWith('.ogg') ? 1 : 0), 0);
}
