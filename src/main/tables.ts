import fs from 'node:fs';
import path from 'node:path';
import { roll } from './dice';

// Tabelas aleatórias: cada .txt da pasta tabelas/ é uma tabela, uma opção por linha.
// - Linhas vazias e começando com # são ignoradas.
// - "3x Goblin" vale por três linhas (peso).
// - [[1d6]] dentro do texto é rolado na hora: "[[2d4]] lobos famintos".

export interface TableResult {
  tabela: string;
  texto: string;
}

export function listTables(dir: string): string[] {
  fs.mkdirSync(dir, { recursive: true });
  return fs
    .readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith('.txt') && f.toLowerCase() !== 'leia-me.txt')
    .map((f) => f.replace(/\.txt$/i, ''))
    .sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true }));
}

export function rollTable(dir: string, nome: string, random: () => number = Math.random): TableResult {
  const file = path.join(dir, `${path.basename(nome)}.txt`);
  if (!fs.existsSync(file)) throw new Error(`Tabela "${nome}" não encontrada.`);
  const opcoes: string[] = [];
  for (const linha of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const texto = linha.trim();
    if (!texto || texto.startsWith('#')) continue;
    const peso = texto.match(/^(\d+)x\s+(.+)$/i);
    if (peso) for (let i = 0; i < Math.min(100, Number(peso[1])); i++) opcoes.push(peso[2]);
    else opcoes.push(texto);
  }
  if (opcoes.length === 0) throw new Error(`A tabela "${nome}" está vazia.`);
  const sorteada = opcoes[Math.floor(random() * opcoes.length)];
  const texto = sorteada.replace(/\[\[([^\]]+)\]\]/g, (_m, expr: string) => {
    try {
      return String(roll(expr, random).total);
    } catch {
      return `[[${expr}]]`;
    }
  });
  return { tabela: nome, texto };
}
