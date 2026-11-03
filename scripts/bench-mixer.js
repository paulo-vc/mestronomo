// Benchmark do mixer: quanto custa cada quadro de 20 ms (mixagem + Opus) numa mesa típica.
// Rode com: npm run build && node scripts/bench-mixer.js
const path = require('node:path');
const { Mixer, FRAME_VALUES } = require(path.join(__dirname, '..', 'dist', 'main', 'mixer.js'));

/** Fonte sintética: ruído constante, sem ffmpeg, para medir só o mixer. */
function fakeSource(bus, extra = {}) {
  const noise = new Int16Array(FRAME_VALUES);
  for (let i = 0; i < noise.length; i++) noise[i] = (Math.random() * 2 - 1) * 8000;
  return { bus, volume: 0.8, read: (out) => (out.set(noise), true), stop() {}, ...extra };
}

const FRAMES = 3000; // 60 s de áudio
const mixer = new Mixer();
mixer.settings.monitor = 'tudo';
mixer.createOpusStream(); // com uma saída, o quadro também é codificado em Opus
mixer.add(fakeSource('musica'));
for (let i = 0; i < 3; i++) mixer.add(fakeSource('ambiente'));
mixer.add(fakeSource('efeitos'));
mixer.add(fakeSource('efeitos', { ducks: false }));

const tempos = { mix: 0, total: 0 };
const mix = mixer.mix.bind(mixer);
mixer.mix = () => {
  const t = performance.now();
  const r = mix();
  tempos.mix += performance.now() - t;
  return r;
};
// Aquece o JIT antes de medir.
for (let i = 0; i < 200; i++) mixer.emitFrame();
tempos.mix = 0;
const inicio = performance.now();
for (let i = 0; i < FRAMES; i++) mixer.emitFrame();
tempos.total = performance.now() - inicio;

const porQuadro = (ms) => (ms / FRAMES).toFixed(3);
console.log(`mixagem: ${porQuadro(tempos.mix)} ms/quadro`);
console.log(`Opus + resto: ${porQuadro(tempos.total - tempos.mix)} ms/quadro`);
console.log(`total: ${porQuadro(tempos.total)} ms/quadro = ${((tempos.total / FRAMES / 20) * 100).toFixed(1)}% de um núcleo`);
process.exit(0);
