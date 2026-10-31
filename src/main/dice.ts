// Rolador de dados: "2d20kh1+5", "d%", "4d6kh3", "1d8+2d6-1", "vantagem+3".
// kh/kl = manter os N maiores/menores; "k" sozinho é kh.

export interface DieGroup {
  quantidade: number;
  lados: number;
  rolagens: number[];
  /** Índices das rolagens que contam (as descartadas por kh/kl ficam de fora). */
  mantidas: Set<number>;
  sinal: 1 | -1;
}

export interface RollResult {
  expressao: string;
  grupos: DieGroup[];
  modificador: number;
  total: number;
  /** 'critico' ou 'falha' quando há exatamente um d20 mantido e ele saiu 20 ou 1. */
  natural?: 'critico' | 'falha';
}

const MAX_DADOS = 100;
const MAX_LADOS = 1000;

const ALIASES: Record<string, string> = {
  vantagem: '2d20kh1',
  adv: '2d20kh1',
  desvantagem: '2d20kl1',
  dis: '2d20kl1',
};

export function roll(input: string, random: () => number = Math.random): RollResult {
  let expressao = input.toLowerCase().replace(/\s+/g, '');
  // Do mais longo para o mais curto: "desvantagem" antes de "vantagem".
  for (const [alias, dados] of Object.entries(ALIASES).sort((a, b) => b[0].length - a[0].length)) {
    expressao = expressao.replaceAll(alias, dados);
  }
  if (!expressao) throw new Error('Expressão vazia. Exemplo: 2d20kh1+5');

  const termos = expressao.match(/[+-]?[^+-]+/g) ?? [];
  if (termos.join('') !== expressao) throw new Error(`Não entendi "${input}". Exemplo: 2d20kh1+5`);

  const grupos: DieGroup[] = [];
  let modificador = 0;
  for (const termo of termos) {
    const sinal = termo.startsWith('-') ? -1 : 1;
    const corpo = termo.replace(/^[+-]/, '');
    if (/^\d+$/.test(corpo)) {
      modificador += sinal * Number(corpo);
      continue;
    }
    const m = corpo.match(/^(\d*)d(\d+|%)(?:(kh|kl|k)(\d+))?$/);
    if (!m) throw new Error(`Não entendi "${termo}". Exemplo: 2d20kh1+5`);
    const quantidade = m[1] ? Number(m[1]) : 1;
    const lados = m[2] === '%' ? 100 : Number(m[2]);
    if (quantidade < 1 || quantidade > MAX_DADOS) throw new Error(`Use de 1 a ${MAX_DADOS} dados por grupo.`);
    if (lados < 2 || lados > MAX_LADOS) throw new Error(`Dados de 2 a ${MAX_LADOS} lados.`);
    const rolagens = Array.from({ length: quantidade }, () => 1 + Math.floor(random() * lados));
    const manter = m[3] ? Math.min(quantidade, Number(m[4])) : quantidade;
    const ordem = rolagens.map((v, i) => ({ v, i })).sort((a, b) => (m[3] === 'kl' ? a.v - b.v : b.v - a.v));
    const mantidas = new Set(ordem.slice(0, manter).map((x) => x.i));
    grupos.push({ quantidade, lados, rolagens, mantidas, sinal: sinal as 1 | -1 });
  }

  const total = modificador + grupos.reduce((soma, g) => soma + g.sinal * g.rolagens.reduce((s, v, i) => s + (g.mantidas.has(i) ? v : 0), 0), 0);
  const d20s = grupos.filter((g) => g.lados === 20 && g.sinal === 1 && g.mantidas.size === 1);
  let natural: RollResult['natural'];
  if (grupos.length === 1 && d20s.length === 1) {
    const g = d20s[0];
    const valor = g.rolagens[[...g.mantidas][0]];
    natural = valor === 20 ? 'critico' : valor === 1 ? 'falha' : undefined;
  }
  return { expressao, grupos, modificador, total, natural };
}

/** Texto para o Discord: "`2d20kh1+5` → [~~3~~, **17**] + 5 = **22**". */
export function formatRoll(r: RollResult) {
  const partes = r.grupos.map((g, gi) => {
    const dados = g.rolagens.map((v, i) => (g.mantidas.has(i) ? `**${v}**` : `~~${v}~~`)).join(', ');
    const sinal = gi === 0 ? (g.sinal < 0 ? '- ' : '') : g.sinal < 0 ? ' - ' : ' + ';
    return `${sinal}[${dados}]`;
  });
  if (r.modificador) partes.push(`${r.modificador < 0 ? ' - ' : ' + '}${Math.abs(r.modificador)}`);
  const destaque = r.natural === 'critico' ? '  ✨ **CRÍTICO!**' : r.natural === 'falha' ? '  💀 **falha crítica**' : '';
  return `\`${r.expressao}\` → ${partes.join('')} = **${r.total}**${destaque}`;
}
