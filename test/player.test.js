// Player: ordem aleatória, crossfade entre faixas e volume igualado.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { load, tempDir, makeWav, precisaFfmpeg, sequencia } = require('./helpers');

const { Mixer } = load('mixer');
const { YouTubePlayer } = load('youtube');

const faixa = (url, duration) => ({ url, title: path.basename(url), duration, local: true });

test('aleatório: não repete as faixas recentes', () => {
  const p = new YouTubePlayer(new Mixer());
  p.queue = Array.from({ length: 8 }, (_, i) => faixa(`f${i}`, 60));
  p.shuffle = true;
  p.current = 3;
  p['history'] = [0, 1, 2];
  for (let i = 0; i < 50; i++) {
    const n = p.nextIndex(sequencia([i / 50]));
    assert.ok(![0, 1, 2, 3].includes(n), `sorteou ${n}, que tocou há pouco`);
  }
  p.queue = [faixa('f0', 60)];
  p.current = 0;
  assert.equal(p.nextIndex(), -1, 'uma faixa só e sem repetir a fila: acaba');
  p.loop = 'fila';
  assert.equal(p.nextIndex(), 0);
});

test('em ordem: avança, e no fim só volta ao começo repetindo a fila', () => {
  const p = new YouTubePlayer(new Mixer());
  p.queue = [faixa('a', 60), faixa('b', 60)];
  p.current = 0;
  assert.equal(p.nextIndex(), 1);
  p.current = 1;
  assert.equal(p.nextIndex(), -1);
  p.loop = 'fila';
  assert.equal(p.nextIndex(), 0);
});

/** Toca a fila com o mixer de verdade e devolve o volume (RMS) de cada quadro do monitor. */
async function tocar(t, faixas, ajustes, segundos) {
  const mixer = new Mixer();
  Object.assign(mixer.settings, { monitor: 'tudo', musica: 1, master: 1 });
  const niveis = [];
  const fontes = [];
  mixer.on('monitor', (pcm) => {
    let s = 0;
    for (let i = 0; i < pcm.length; i += 2) s += (pcm.readInt16LE(i) / 32768) ** 2;
    niveis.push(Math.sqrt(s / (pcm.length / 2)));
    fontes.push(mixer['sources'].size);
  });
  const p = new YouTubePlayer(mixer);
  Object.assign(p, { volume: 1 }, ajustes);
  mixer.start();
  t.after(() => mixer.stop());
  p.addTracks(faixas);
  await new Promise((r) => setTimeout(r, segundos * 1000));
  return { p, niveis, fontes };
}

test('crossfade: a próxima faixa entra antes do fim, sem buraco no som', precisaFfmpeg, async (t) => {
  const dir = tempDir(t);
  const a = makeWav(path.join(dir, 'a.wav'), 3, 330);
  const b = makeWav(path.join(dir, 'b.wav'), 3, 550);
  const { p, niveis, fontes } = await tocar(t, [faixa(a, 3), faixa(b, 3)], { crossfadeMs: 1000, normalize: false }, 4.5);
  assert.equal(p.current, 1, 'passou para a segunda faixa');
  assert.ok(Math.max(...fontes) >= 2, 'as duas tocaram juntas durante a transição');
  // Do começo da primeira até o meio da segunda, o som nunca some.
  const trecho = niveis.slice(10, 170);
  assert.ok(Math.min(...trecho) > 0.05, `buraco no som: mínimo ${Math.min(...trecho).toFixed(3)}`);
});

test('volume igualado: faixa baixa e faixa alta saem parecidas', precisaFfmpeg, async (t) => {
  const dir = tempDir(t);
  const media = (lista) => lista.slice(30).reduce((x, y) => x + y, 0) / (lista.length - 30);
  const nivel = async (amp, normalize) => media((await tocar(t, [faixa(makeWav(path.join(dir, `${amp}-${normalize}.wav`), 3, 440, amp), 3)], { normalize, crossfadeMs: 0 }, 2.2)).niveis);
  const semFiltro = (await nivel(0.6, false)) / (await nivel(0.05, false));
  const comFiltro = (await nivel(0.6, true)) / (await nivel(0.05, true));
  assert.ok(semFiltro > 8, `sem igualar, a diferença é grande (${semFiltro.toFixed(1)}x)`);
  assert.ok(comFiltro < 1.5, `igualado, ficam próximas (${comFiltro.toFixed(2)}x)`);
});
