// Rolador de dados, no estilo do Rollem:
//   d20+5            soma           2d20kh1+5 / vantagem   manter os maiores (kh) ou menores (kl)
//   4d6dl1           descartar      3d6!                   dado explode no máximo (rola mais um)
//   2d6r2            rola de novo (uma vez) resultados ≤ 2
//   (2d6+3)*2        parênteses, * e /       d20+5 >= 15   sucesso ou falha
//   3#d20+5          três rolagens separadas (sem somar)
//   d20+5 ataque     o que vem depois da expressão é o rótulo

export interface Die {
  valor: number;
  /** Fora da soma: descartado por kh/kl/dh/dl ou substituído por uma rerrolagem. */
  descartado: boolean;
  /** Saiu de uma explosão (!). */
  explosao: boolean;
}

export interface DieGroup {
  quantidade: number;
  lados: number;
  dados: Die[];
}

export type Comparador = '>=' | '<=' | '>' | '<' | '=';

export interface RollResult {
  expressao: string;
  /** Os dados no lugar de cada grupo: "[~~3~~, **17**] + 5". */
  detalhe: string;
  grupos: DieGroup[];
  total: number;
  /** 'critico' ou 'falha' quando a expressão tem um único d20 mantido e ele saiu 20 ou 1. */
  natural?: 'critico' | 'falha';
  /** Com ">= 15" e afins: o alvo e se passou. */
  teste?: { comparador: Comparador; alvo: number; sucesso: boolean };
}

/** O que alguém digitou: uma ou várias rolagens (3#...) e um rótulo opcional. */
export interface RollCommand {
  expressao: string;
  rolagens: RollResult[];
  rotulo?: string;
}

const MAX_DADOS = 100;
const MAX_DADOS_TOTAL = 500;
const MAX_LADOS = 1000;
const MAX_REPETICOES = 20;
const MAX_EXPLOSOES = 100;
const EXEMPLO = 'Exemplos: d20+5, 2d20kh1, 4d6dl1, 3#d20+5';

const ALIASES: [string, string][] = [
  ['desvantagem', '2d20kl1'],
  ['vantagem', '2d20kh1'],
  ['adv', '2d20kh1'],
  ['dis', '2d20kl1'],
];

const SIMBOLO: Record<Comparador, string> = { '>=': '≥', '<=': '≤', '>': '>', '<': '<', '=': '=' };

/** Uma rolagem (sem # e sem rótulo). */
export function roll(input: string, random: () => number = Math.random, original = input): RollResult {
  let expressao = input.toLowerCase().replace(/\s+/g, '');
  for (const [alias, dados] of ALIASES) expressao = expressao.replaceAll(alias, dados);
  if (!expressao) throw new Error(`Expressão vazia. ${EXEMPLO}`);

  const comp = expressao.match(/^(.+?)(>=|<=|>|<|=)(-?\d+)$/);
  const conta = comp ? comp[1] : expressao;
  const parser = new Parser(conta, random, original);
  const { valor, texto } = parser.expressao();
  if (parser.pos < conta.length) throw new Error(`Não entendi "${original}". ${EXEMPLO}`);

  const grupos = parser.grupos;
  let natural: RollResult['natural'];
  if (grupos.length === 1 && grupos[0].lados === 20) {
    const mantidos = grupos[0].dados.filter((d) => !d.descartado);
    if (mantidos.length === 1) natural = mantidos[0].valor === 20 ? 'critico' : mantidos[0].valor === 1 ? 'falha' : undefined;
  }
  let teste: RollResult['teste'];
  if (comp) {
    const comparador = comp[2] as Comparador;
    const alvo = Number(comp[3]);
    const sucesso = { '>=': valor >= alvo, '<=': valor <= alvo, '>': valor > alvo, '<': valor < alvo, '=': valor === alvo }[comparador];
    teste = { comparador, alvo, sucesso };
  }
  return { expressao, detalhe: texto, grupos, total: valor, natural, teste };
}

/**
 * O comando inteiro: "3#d20+5 ataque com espada" → 3 rolagens de d20+5 com o rótulo
 * "ataque com espada". O rótulo é o que sobra depois da maior parte inicial que é uma expressão.
 */
export function rollCommand(input: string, random: () => number = Math.random): RollCommand {
  const palavras = input.trim().split(/\s+/).filter(Boolean);
  if (palavras.length === 0) throw new Error(`Expressão vazia. ${EXEMPLO}`);
  let primeiroErro: Error | undefined;
  for (let n = palavras.length; n >= 1; n--) {
    // Palavras só se juntam com um operador entre elas: "d20 + 5" sim, "d20 3 vezes" não (viraria d203).
    if (!palavras.slice(0, n).every((p, i) => i === 0 || /[-+*/(#<>=]$/.test(palavras[i - 1]) || /^[-+*/)<>=]/.test(p))) continue;
    const texto = palavras.slice(0, n).join('');
    try {
      const { repeticoes, conta } = separarRepeticao(texto);
      roll(conta, () => 0, palavras.slice(0, n).join(' ')); // só valida, sem gastar o random de verdade
      const rotulo = palavras.slice(n).join(' ') || undefined;
      const rolagens = Array.from({ length: repeticoes }, () => roll(conta, random, palavras.slice(0, n).join(' ')));
      return { expressao: texto.toLowerCase(), rolagens, rotulo };
    } catch (err) {
      primeiroErro ??= err as Error;
    }
  }
  throw primeiroErro!;
}

function separarRepeticao(texto: string) {
  const m = texto.match(/^(\d+)#(.+)$/);
  if (!m) return { repeticoes: 1, conta: texto };
  const repeticoes = Number(m[1]);
  if (repeticoes < 1 || repeticoes > MAX_REPETICOES) throw new Error(`Use de 1 a ${MAX_REPETICOES} rolagens com #.`);
  return { repeticoes, conta: m[2] };
}

/** Texto para o Discord: "`2d20kh1+5` → [~~3~~, **17**] + 5 = **22**". */
export function formatRoll(r: RollResult) {
  return `\`${r.expressao}\` → ${resultado(r)}`;
}

/** "[~~3~~, **17**] + 5 = **22**", com crítico e sucesso/falha quando houver. */
function resultado(r: RollResult) {
  let texto = `${r.detalhe} = **${r.total}**`;
  if (r.teste) texto += ` ${SIMBOLO[r.teste.comparador]} ${r.teste.alvo} ${r.teste.sucesso ? '✅ sucesso' : '❌ falha'}`;
  if (r.natural === 'critico') texto += '  ✨ **CRÍTICO!**';
  if (r.natural === 'falha') texto += '  💀 **falha crítica**';
  return texto;
}

/**
 * O comando inteiro, pronto para o Discord (até ~1900 caracteres: com dados demais,
 * mostra só os totais).
 */
export function formatCommand(c: RollCommand) {
  const rotulo = c.rotulo ? ` — *${c.rotulo}*` : '';
  if (c.rolagens.length === 1) {
    const texto = `\`${c.expressao}\`${rotulo} → ${resultado(c.rolagens[0])}`;
    return texto.length <= 1900 ? texto : `\`${c.expressao}\`${rotulo} → **${c.rolagens[0].total}** *(dados demais para listar)*`;
  }
  const linhas = c.rolagens.map((r, i) => `${i + 1}. ${resultado(r)}`);
  const testes = c.rolagens.filter((r) => r.teste);
  const sucessos = testes.filter((r) => r.teste!.sucesso).length;
  const rodape = testes.length ? `\n**${sucessos}** de ${testes.length} ${sucessos === 1 ? 'sucesso' : 'sucessos'}` : '';
  const texto = `\`${c.expressao}\`${rotulo}\n${linhas.join('\n')}${rodape}`;
  if (texto.length <= 1900) return texto;
  return `\`${c.expressao}\`${rotulo} → ${c.rolagens.map((r) => `**${r.total}**`).join(', ')}${rodape}`;
}

/** Análise descendente recursiva: soma/subtração > multiplicação/divisão > sinal > ( ), dados e números. */
class Parser {
  pos = 0;
  grupos: DieGroup[] = [];
  private totalDados = 0;

  constructor(
    private s: string,
    private random: () => number,
    private original: string,
  ) {}

  expressao(): { valor: number; texto: string } {
    let esq = this.termo();
    while (this.s[this.pos] === '+' || this.s[this.pos] === '-') {
      const op = this.s[this.pos++];
      const dir = this.termo();
      esq = { valor: op === '+' ? esq.valor + dir.valor : esq.valor - dir.valor, texto: `${esq.texto} ${op} ${dir.texto}` };
    }
    return esq;
  }

  private termo(): { valor: number; texto: string } {
    let esq = this.unario();
    while (this.s[this.pos] === '*' || this.s[this.pos] === '/') {
      const op = this.s[this.pos++];
      const dir = this.unario();
      if (op === '/') {
        if (dir.valor === 0) throw new Error('Divisão por zero.');
        // Arredonda para baixo, como "metade do dano" nas regras.
        esq = { valor: Math.floor(esq.valor / dir.valor), texto: `${esq.texto} ÷ ${dir.texto}` };
      } else {
        esq = { valor: esq.valor * dir.valor, texto: `${esq.texto} × ${dir.texto}` };
      }
    }
    return esq;
  }

  private unario(): { valor: number; texto: string } {
    if (this.s[this.pos] === '-') {
      this.pos++;
      const v = this.unario();
      return { valor: -v.valor, texto: `-${v.texto}` };
    }
    if (this.s[this.pos] === '+') {
      this.pos++;
      return this.unario();
    }
    return this.primario();
  }

  private primario(): { valor: number; texto: string } {
    if (this.s[this.pos] === '(') {
      this.pos++;
      const v = this.expressao();
      if (this.s[this.pos] !== ')') throw new Error(`Faltou fechar um parêntese em "${this.original}".`);
      this.pos++;
      return { valor: v.valor, texto: `(${v.texto})` };
    }
    const resto = this.s.slice(this.pos);
    const dado = resto.match(/^(\d*)d(\d+|%)((?:kh|kl|dh|dl|k|r|!)\d*)*/);
    if (dado) {
      this.pos += dado[0].length;
      return this.rolar(dado[0]);
    }
    const numero = resto.match(/^\d+/);
    if (numero) {
      this.pos += numero[0].length;
      return { valor: Number(numero[0]), texto: numero[0] };
    }
    throw new Error(`Não entendi "${this.original}". ${EXEMPLO}`);
  }

  /** Um grupo de dados com os modificadores: "4d6dl1", "3d6!", "2d6r2", "2d20kh1". */
  private rolar(token: string): { valor: number; texto: string } {
    const [, qtd, faces, mods = ''] = token.match(/^(\d*)d(\d+|%)(.*)$/)!;
    const quantidade = qtd ? Number(qtd) : 1;
    const lados = faces === '%' ? 100 : Number(faces);
    if (quantidade < 1 || quantidade > MAX_DADOS) throw new Error(`Use de 1 a ${MAX_DADOS} dados por grupo.`);
    if (lados < 2 || lados > MAX_LADOS) throw new Error(`Dados de 2 a ${MAX_LADOS} lados.`);

    let explode = false;
    let rerrolar = 0;
    let manter: { tipo: 'kh' | 'kl' | 'dh' | 'dl'; n: number } | undefined;
    for (const [, mod, num] of mods.matchAll(/(kh|kl|dh|dl|k|r|!)(\d*)/g)) {
      if (mod === '!') explode = true;
      else if (mod === 'r') {
        if (!num) throw new Error('Diga até qual valor rolar de novo, ex.: 2d6r2.');
        rerrolar = Number(num);
        if (rerrolar >= lados) throw new Error(`r${rerrolar} rolaria de novo todos os resultados de um d${lados}.`);
      } else manter = { tipo: mod === 'k' ? 'kh' : (mod as 'kh' | 'kl' | 'dh' | 'dl'), n: num ? Number(num) : 1 };
    }

    const dados: Die[] = [];
    const umDado = (explosao = false) => {
      if (++this.totalDados > MAX_DADOS_TOTAL) throw new Error(`Dados demais (máximo ${MAX_DADOS_TOTAL} por rolagem).`);
      return { valor: 1 + Math.floor(this.random() * lados), descartado: false, explosao };
    };
    for (let i = 0; i < quantidade; i++) {
      let d = umDado();
      if (rerrolar && d.valor <= rerrolar) {
        dados.push({ ...d, descartado: true });
        d = umDado();
      }
      dados.push(d);
      // Explode: cada máximo rola mais um dado (que também pode explodir).
      let explosoes = 0;
      while (explode && d.valor === lados && explosoes++ < MAX_EXPLOSOES) {
        d = umDado(true);
        dados.push(d);
      }
    }

    if (manter) {
      const validos = dados.map((d, i) => ({ d, i })).filter(({ d }) => !d.descartado);
      const n = Math.min(manter.n, validos.length);
      const crescente = [...validos].sort((a, b) => a.d.valor - b.d.valor);
      // kh/dl ficam com os maiores; kl/dh com os menores.
      const fora =
        manter.tipo === 'kh' ? crescente.slice(0, validos.length - n)
        : manter.tipo === 'kl' ? crescente.slice(n)
        : manter.tipo === 'dl' ? crescente.slice(0, n)
        : crescente.slice(validos.length - n);
      for (const { i } of fora) dados[i].descartado = true;
    }

    this.grupos.push({ quantidade, lados, dados });
    const valor = dados.reduce((s, d) => s + (d.descartado ? 0 : d.valor), 0);
    const texto = `[${dados.map((d) => (d.descartado ? `~~${d.valor}~~` : `**${d.valor}**${d.explosao ? '💥' : ''}`)).join(', ')}]`;
    return { valor, texto };
  }
}
