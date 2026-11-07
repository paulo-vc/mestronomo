// Áudio: mixer (ducking, fades, monitor), filtros e cache de PCM.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { load, tempDir, makeWav, precisaFfmpeg, rms } = require('./helpers');

const { FRAME_VALUES, SAMPLE_RATE } = load('audioFormat');
const { Mixer } = load('mixer');

/** Fonte sintética: um valor constante, para medir ganhos com precisão. */
function constante(bus, valor, extra = {}) {
  return { bus, volume: 1, read: (out) => (out.fill(valor), true), stop() {}, ...extra };
}

/** Roda n quadros e devolve o último quadro do bot e do monitor como amostras. */
function quadros(mixer, n) {
  let ultimo = {};
  for (let i = 0; i < n; i++) ultimo = mixer.mix();
  const amostras = (buf) => (buf ? new Int16Array(buf.buffer, buf.byteOffset, buf.length / 2) : undefined);
  return { bot: amostras(ultimo.bot), monitor: amostras(ultimo.monitor) };
}

test('mixer: volumes de fonte, grupo e geral se multiplicam', () => {
  const m = new Mixer();
  Object.assign(m.settings, { musica: 0.5, master: 0.5 });
  m.add(constante('musica', 10000, { volume: 0.8 }));
  assert.equal(quadros(m, 1).bot[0], 2000);
});

test('mixer: efeito abaixa a música (ducking) e loop de fundo não', () => {
  const m = new Mixer();
  Object.assign(m.settings, { musica: 1, efeitos: 1, master: 1, ducking: 0.35 });
  m.add(constante('musica', 10000));
  const loop = constante('efeitos', 0, { ducks: false });
  m.add(loop);
  assert.equal(quadros(m, 20).bot.at(-1), 10000, 'loop com ducks=false não abaixa');
  m.add(constante('efeitos', 0));
  const final = quadros(m, 40).bot.at(-1);
  assert.ok(Math.abs(final - 3500) < 50, `música a ~35% (${final})`);
});

test('mixer: fade-in sobe do silêncio e fade-out tira a fonte', () => {
  const m = new Mixer();
  Object.assign(m.settings, { ambiente: 1, master: 1 });
  const fonte = constante('ambiente', 10000);
  m.fadeIn(fonte, 200); // 10 quadros
  assert.ok(Math.abs(quadros(m, 1).bot.at(-1)) < 1100, 'começa baixo');
  assert.equal(quadros(m, 12).bot.at(-1), 10000, 'chega ao volume cheio');
  m.fadeOut(fonte, 200);
  quadros(m, 12);
  assert.equal(m.has(fonte), false);
});

test('mixer: pré-escuta só no monitor e capturas fora do modo "sem-capturas"', () => {
  const m = new Mixer();
  Object.assign(m.settings, { musica: 1, efeitos: 1, master: 1, monitor: 'sem-capturas' });
  m.add(constante('efeitos', 1000, { preview: true }));
  m.add(constante('musica', 3000, { live: true }));
  const { bot, monitor } = quadros(m, 1);
  assert.equal(bot[0], 3000, 'bot: só a captura');
  assert.equal(monitor[0], 1000, 'monitor: só a pré-escuta');
  m.settings.monitor = 'tudo';
  assert.equal(quadros(m, 1).monitor[0], 4000);
});

test('filtros: abafado corta agudo, caverna deixa cauda, eco volta em 320 ms', () => {
  const { FilterChain } = load('dsp');
  const desligado = { abafado: false, caverna: false, eco: false };
  function tom(freq, filtros) {
    const c = new FilterChain();
    let fase = 0;
    let b;
    for (let f = 0; f < 40; f++) {
      b = new Float32Array(FRAME_VALUES);
      for (let i = 0; i < FRAME_VALUES; i += 2) {
        b[i] = b[i + 1] = Math.sin(fase) * 10000;
        fase += (2 * Math.PI * freq) / SAMPLE_RATE;
      }
      c.process(b, filtros);
    }
    return rms(b);
  }
  assert.ok(tom(5000, { ...desligado, abafado: true }) < tom(5000, desligado) * 0.05, 'agudo cai mais de 95%');
  assert.ok(tom(100, { ...desligado, abafado: true }) > tom(100, desligado) * 0.95, 'grave fica');

  function estalo(filtros) {
    const c = new FilterChain();
    for (let f = 0; f < 15; f++) c.process(new Float32Array(FRAME_VALUES), filtros);
    return Array.from({ length: 30 }, (_, f) => {
      const b = new Float32Array(FRAME_VALUES);
      if (f === 0) b.fill(10000, 0, 960);
      c.process(b, filtros);
      return rms(b);
    });
  }
  assert.ok(estalo({ ...desligado, caverna: true }).slice(10).some((v) => v > 1), 'cauda de reverberação');
  const eco = estalo({ ...desligado, eco: true });
  assert.equal(eco.indexOf(Math.max(...eco.slice(5))), 16, 'eco no quadro 16 = 320 ms');
  const parado = new FilterChain();
  assert.equal(parado.process(new Float32Array(FRAME_VALUES), desligado), false, 'desligado não processa nada');
});

test('cache: decodifica, toca da memória, respeita limite e orçamento', precisaFfmpeg, async (t) => {
  const { PcmCache, MemorySource, playFile } = load('pcmCache');
  const dir = tempDir(t);
  const um = makeWav(path.join(dir, 'um.wav'), 1);
  const tres = makeWav(path.join(dir, 'tres.wav'), 3);
  const cinco = makeWav(path.join(dir, 'cinco.wav'), 5);
  const c = new PcmCache(1_000_000, 700_000);
  assert.equal(playFile(c, um, 'efeitos').constructor.name, 'FileSource', 'primeira vez: streaming');
  const pcm = await c.load(um);
  assert.equal(pcm.length, 96000);
  assert.equal(playFile(c, um, 'efeitos').constructor.name, 'MemorySource');
  assert.equal(await c.load(cinco), undefined, 'acima do limite fica no streaming');

  const out = new Int16Array(FRAME_VALUES);
  const fonte = new MemorySource(pcm, 'efeitos');
  let n = 1;
  while (fonte.read(out)) n++;
  assert.equal(n, 50, '1 s = 50 quadros');
  const loop = new MemorySource(pcm, 'ambiente', false, true);
  for (let i = 0; i < 200; i++) assert.equal(loop.read(out), true);

  const c2 = new PcmCache(600_000, 1_000_000);
  await c2.load(um);
  await c2.load(tres);
  assert.equal(c2.get(um), undefined, 'o menos usado sai');
  assert.ok(c2.get(tres));
});

test('cache: loop que começou por streaming passa para a memória e fecha o ffmpeg', precisaFfmpeg, async (t) => {
  const { PcmCache, playFile } = load('pcmCache');
  const dir = tempDir(t);
  const arquivo = makeWav(path.join(dir, 'camada.wav'), 2);
  const c = new PcmCache();
  const fonte = playFile(c, arquivo, 'ambiente', false, true);
  assert.equal(fonte.constructor.name, 'LoopSource');
  fonte.volume = 0.4;
  fonte.ducks = false;
  const ffmpeg = fonte.atual.ffmpeg;
  const out = new Int16Array(FRAME_VALUES);
  // Toca alguns quadros por streaming e espera o cache terminar de decodificar.
  const inicio = Date.now();
  while (!c.get(arquivo) && Date.now() - inicio < 10000) {
    fonte.read(out);
    await new Promise((r) => setTimeout(r, 20));
  }
  assert.ok(c.get(arquivo), 'decodificou');
  assert.equal(fonte.read(out), true);
  assert.equal(fonte.naMemoria, true, 'trocou para a memória');
  assert.equal(fonte.volume, 0.4, 'manteve o volume');
  assert.equal(fonte.ducks, false, 'manteve o ducking');
  // O ffmpeg do streaming foi encerrado (no Windows, a pasta temporária só sai depois disso).
  await new Promise((r) => (ffmpeg.exitCode !== null || ffmpeg.signalCode !== null ? r() : ffmpeg.once('exit', r)));
  for (let i = 0; i < 300; i++) assert.equal(fonte.read(out), true, 'continua em loop');
  fonte.stop();
  assert.equal(fonte.read(out), false);
});
