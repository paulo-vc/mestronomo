import fs from 'node:fs';
import path from 'node:path';

// Busca e download de efeitos do Freesound (https://freesound.org). Precisa de uma chave de API
// gratuita do próprio usuário. Baixamos a prévia em MP3 de alta qualidade, que não exige OAuth e
// é suficiente para efeitos; a licença e o autor vão para um arquivo de créditos.

const API = 'https://freesound.org/apiv2';
export const KEY_URL = 'https://freesound.org/apiv2/apply';

export interface FreesoundResult {
  id: number;
  nome: string;
  duracao: number;
  autor: string;
  licenca: string;
  previa: string;
  pagina: string;
}

const LICENCAS: Record<string, string> = {
  'http://creativecommons.org/publicdomain/zero/1.0/': 'CC0',
  'https://creativecommons.org/publicdomain/zero/1.0/': 'CC0',
  'http://creativecommons.org/licenses/by/4.0/': 'CC BY',
  'https://creativecommons.org/licenses/by/4.0/': 'CC BY',
  'http://creativecommons.org/licenses/by/3.0/': 'CC BY',
  'http://creativecommons.org/licenses/by-nc/4.0/': 'CC BY-NC',
  'https://creativecommons.org/licenses/by-nc/4.0/': 'CC BY-NC',
  'http://creativecommons.org/licenses/by-nc/3.0/': 'CC BY-NC',
  'http://creativecommons.org/licenses/sampling+/1.0/': 'Sampling+',
};

export async function search(query: string, key: string, maxSeconds = 60): Promise<FreesoundResult[]> {
  const params = new URLSearchParams({
    query,
    token: key,
    fields: 'id,name,duration,username,license,previews,url',
    filter: `duration:[0 TO ${maxSeconds}]`,
    sort: 'score',
    page_size: '20',
  });
  const res = await fetch(`${API}/search/text/?${params}`);
  if (res.status === 401) throw new Error('Chave do Freesound inválida. Confira em ⚙ → Freesound.');
  if (res.status === 429) throw new Error('Muitas buscas seguidas no Freesound; espere um minuto.');
  if (!res.ok) throw new Error(`O Freesound respondeu ${res.status}.`);
  const data = (await res.json()) as {
    results: { id: number; name: string; duration: number; username: string; license: string; previews: Record<string, string>; url: string }[];
  };
  return data.results.map((r) => ({
    id: r.id,
    nome: r.name.replace(/\.(wav|mp3|ogg|flac|aiff?)$/i, ''),
    duracao: r.duration,
    autor: r.username,
    licenca: LICENCAS[r.license] ?? r.license,
    previa: r.previews['preview-hq-mp3'],
    pagina: r.url,
  }));
}

/** Baixa a prévia HQ para `destDir` e anota o crédito em CREDITOS-freesound.txt. Devolve o nome do arquivo. */
export async function download(som: FreesoundResult, destDir: string) {
  const res = await fetch(som.previa);
  if (!res.ok) throw new Error(`Não consegui baixar "${som.nome}" (${res.status}).`);
  fs.mkdirSync(destDir, { recursive: true });
  const base = som.nome.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim().slice(0, 80) || `freesound ${som.id}`;
  let arquivo = `${base}.mp3`;
  for (let n = 2; fs.existsSync(path.join(destDir, arquivo)); n++) arquivo = `${base} (${n}).mp3`;
  fs.writeFileSync(path.join(destDir, arquivo), Buffer.from(await res.arrayBuffer()));
  const credito = `${arquivo} — "${som.nome}" por ${som.autor} (${som.licenca}) — ${som.pagina}\n`;
  fs.appendFileSync(path.join(destDir, 'CREDITOS-freesound.txt'), credito);
  return arquivo;
}
