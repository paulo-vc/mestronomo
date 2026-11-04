// Monta os pacotes de sons a partir de pacotes/fontes.json:
// baixa as prévias do Freesound (com pausa entre pedidos), pega os arquivos da Kenney,
// e gera .ogg normalizados em pacotes/<id>/ — efeitos sem silêncio no começo e com duração
// limitada; ambientes como loops sem emenda (o fim faz crossfade com o começo).
//
// Uso: node scripts/montar-pacotes.js <pasta-de-downloads>
// A pasta precisa ter kenney-rpg/ e kenney-casino/ (zips de fontes.json extraídos); as
// prévias do Freesound são baixadas para <pasta>/freesound/ e reaproveitadas depois.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const DOWNLOADS = process.argv[2];
if (!DOWNLOADS) {
  console.error('Uso: node scripts/montar-pacotes.js <pasta-de-downloads>');
  process.exit(1);
}
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'pacotes', 'fontes.json'), 'utf8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const LOOP_MAX = 75; // segundos de cada loop de ambiente
const CROSSFADE = 3; // segundos de emenda entre o fim e o começo do loop
const EFEITO_MAX = 6;

function ffmpeg(args) {
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: ['ignore', 'ignore', 'inherit'] });
}

function duration(file) {
  let err = '';
  try {
    execFileSync('ffmpeg', ['-hide_banner', '-i', file], { stdio: ['ignore', 'ignore', 'pipe'] });
  } catch (e) {
    err = String(e.stderr);
  }
  const m = err.match(/Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!m) throw new Error(`Não consegui ler a duração de ${file}`);
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

function findKenney(nome) {
  for (const pasta of ['kenney-rpg', 'kenney-casino']) {
    const achado = walk(path.join(DOWNLOADS, pasta)).find((f) => path.basename(f) === nome);
    if (achado) return achado;
  }
  throw new Error(`Arquivo da Kenney não encontrado: ${nome}`);
}

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
}

/** Baixa (uma vez) a prévia HQ de um som do Freesound. */
async function freesoundPreview(url) {
  const id = url.match(/sounds\/(\d+)/)[1];
  const destino = path.join(DOWNLOADS, 'freesound', `${id}.mp3`);
  if (fs.existsSync(destino)) return destino;
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  const pagina = await (await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })).text();
  const previa = pagina.match(/https:\/\/cdn\.freesound\.org\/previews\/[^"]+-hq\.mp3/)?.[0];
  if (!previa) throw new Error(`Prévia não encontrada em ${url}`);
  await sleep(1500);
  const res = await fetch(previa, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`${res.status} ao baixar ${previa}`);
  fs.writeFileSync(destino, Buffer.from(await res.arrayBuffer()));
  await sleep(1500);
  return destino;
}

const fonteLocal = (fonte) => (fonte.startsWith('kenney:') ? findKenney(fonte.slice(7)) : freesoundPreview(fonte));

function efeito(entrada, saida, max = EFEITO_MAX) {
  const d = duration(entrada);
  const filtros = ['silenceremove=start_periods=1:start_threshold=-50dB'];
  if (d > max) filtros.push(`atrim=0:${max}`, `afade=t=out:st=${max - 0.4}:d=0.4`);
  filtros.push('loudnorm=I=-16:TP=-1.5:LRA=11');
  ffmpeg(['-i', entrada, '-af', filtros.join(','), '-ar', '48000', '-ac', '2', '-c:a', 'libvorbis', '-q:a', '4', saida]);
}

/**
 * Loop sem emenda: pega [inicio, inicio+L), e o trecho final faz crossfade com o começo.
 * Tocando em loop, o fim do arquivo cai exatamente onde o começo continua.
 */
function ambiente(entrada, saida, opcoes = {}) {
  const d = duration(entrada);
  const inicio = opcoes.inicio ?? Math.min(2, d * 0.05);
  const L = Math.min(d - inicio, LOOP_MAX);
  const x = Math.min(opcoes.crossfade ?? CROSSFADE, L * 0.2);
  const a = (de, ate) => `atrim=${(inicio + de).toFixed(3)}:${(inicio + ate).toFixed(3)},asetpts=PTS-STARTPTS`;
  const grafo =
    `[0]asplit=3[s1][s2][s3];` +
    `[s1]${a(0, x)}[cabeca];[s2]${a(x, L - x)}[meio];[s3]${a(L - x, L)}[cauda];` +
    `[cauda][cabeca]acrossfade=d=${x.toFixed(3)}:c1=tri:c2=tri[emenda];` +
    `[meio][emenda]concat=n=2:v=0:a=1,loudnorm=I=-24:TP=-2:LRA=11[out]`;
  ffmpeg(['-i', entrada, '-filter_complex', grafo, '-map', '[out]', '-ar', '48000', '-ac', '2', '-c:a', 'libvorbis', '-q:a', '4', saida]);
}

(async () => {
  for (const pacote of manifest.pacotes) {
    const base = path.join(ROOT, 'pacotes', pacote.id);
    fs.rmSync(base, { recursive: true, force: true });
    const creditos = [
      `Pacote ${pacote.nome} do Mestrônomo — sons em domínio público (CC0).`,
      'Créditos por cortesia aos autores:',
      '',
    ];
    for (const item of [...pacote.efeitos.map((e) => ({ ...e, tipo: 'sons' })), ...pacote.ambientes.map((e) => ({ ...e, tipo: 'ambientes' }))]) {
      const saida = path.join(base, item.tipo, `${item.destino}.ogg`);
      fs.mkdirSync(path.dirname(saida), { recursive: true });
      const entrada = await fonteLocal(item.fonte);
      if (item.tipo === 'ambientes' && !item.curto) ambiente(entrada, saida, item);
      else efeito(entrada, saida, item.max);
      const autor = item.fonte.startsWith('kenney:') ? 'Kenney (kenney.nl), via OpenGameArt' : `${item.autor}, Freesound`;
      const fonte = item.fonte.startsWith('kenney:') ? 'https://opengameart.org/users/kenney' : item.fonte;
      creditos.push(`${item.tipo}/${item.destino}.ogg — ${autor} — CC0 — ${fonte}`);
      console.log(`${pacote.id}: ${item.tipo}/${item.destino} (${duration(saida).toFixed(1)} s)`);
    }
    fs.writeFileSync(path.join(base, 'CREDITOS.txt'), creditos.join('\n') + '\n');
    fs.writeFileSync(
      path.join(base, 'pacote.json'),
      JSON.stringify({ id: pacote.id, nome: pacote.nome, descricao: pacote.descricao, cenas: pacote.cenas }, null, 2) + '\n',
    );
  }
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
