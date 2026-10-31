// Interface do Mestrônomo. Conversa com o processo principal via window.mestronomo (preload).
const api = window.mestronomo;
const $ = (sel) => document.querySelector(sel);

const els = {
  bot: $('#bot'),
  botBotao: $('#bot-botao'),
  apps: $('#apps'),
  capturas: $('#capturas'),
  sons: $('#sons'),
  erro: $('#erro'),
  api: $('#api'),
  ytUrl: $('#yt-url'),
  ytTitulo: $('#yt-titulo'),
  ytTempo: $('#yt-tempo'),
  ytPausar: $('#yt-pausar'),
  ytRepetir: $('#yt-repetir'),
  ytFila: $('#yt-fila'),
  ytVolume: document.querySelector('[data-volume="youtube"]'),
};

let botNoCanal = false;
let capturando = [];
let yt = null;
let ytRecebidoEm = 0;
let erroTimer;

const REPETIR = {
  nenhum: { proximo: 'fila', icone: '↻', titulo: 'Repetir: desligado' },
  fila: { proximo: 'faixa', icone: '↻', titulo: 'Repetir: fila inteira' },
  faixa: { proximo: 'nenhum', icone: '↻1', titulo: 'Repetir: só esta faixa' },
};

function el(tag, props = {}, ...filhos) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...filhos);
  return node;
}

function tempo(segundos) {
  if (segundos == null || !Number.isFinite(segundos)) return '';
  const s = Math.floor(segundos);
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(h ? 2 : 1, '0');
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function mostrarErro(msg) {
  els.erro.textContent = msg ?? '';
  clearTimeout(erroTimer);
  if (msg) erroTimer = setTimeout(() => (els.erro.textContent = ''), 8000);
}

function slider(valor, aoMudar) {
  const input = el('input', { type: 'range', min: 0, max: 100, value: Math.round(valor * 100) });
  const saida = el('output', { textContent: `${input.value}%` });
  input.addEventListener('input', () => {
    saida.textContent = `${input.value}%`;
    aoMudar(input.value / 100);
  });
  return [input, saida];
}

// --- Bot ---------------------------------------------------------------

function renderBot(status) {
  const textos = {
    desligado: ['off', status.motivo ?? 'Bot desligado'],
    conectando: ['warn', 'Conectando ao Discord…'],
    aguardando: ['warn', `${status.bot} · fora da call`],
    'no-canal': ['ok', `${status.bot} · ${status.servidor} › ${status.canal}`],
  };
  const [classe, texto] = textos[status.state];
  els.bot.className = `pill ${classe}`;
  els.bot.textContent = texto;
  botNoCanal = status.state === 'no-canal';
  els.botBotao.textContent = botNoCanal ? 'Dispensar bot' : 'Chamar bot';
  els.botBotao.classList.toggle('primary', !botNoCanal);
  els.botBotao.disabled = status.state === 'conectando';
}

els.botBotao.addEventListener('click', () => (botNoCanal ? api.botSair() : api.botEntrar()));

// --- Capturas ----------------------------------------------------------

function renderCapturas(lista) {
  capturando = lista;
  els.capturas.replaceChildren(
    ...lista.map(({ app, volume }) =>
      el(
        'li',
        {},
        el('span', { className: 'nome', textContent: app.replace(/\.exe$/i, '') }),
        ...slider(volume, (v) => api.volumeCaptura(app, v)),
        el('button', { className: 'ghost icone', textContent: '✕', title: 'Parar captura', onclick: () => api.pararCaptura(app) }),
      ),
    ),
  );
  marcarAppsCapturados();
}

function marcarAppsCapturados() {
  for (const option of els.apps.options) option.disabled = capturando.some((c) => c.app === option.value);
  if (els.apps.selectedOptions[0]?.disabled) {
    const livre = [...els.apps.options].find((o) => o.value && !o.disabled);
    if (livre) els.apps.value = livre.value;
  }
}

async function carregarApps() {
  const atual = els.apps.value;
  els.apps.replaceChildren(new Option('Carregando…', ''));
  try {
    const apps = await api.apps();
    els.apps.replaceChildren(
      ...(apps.length
        ? apps.map((a) => new Option(`${a.name}${a.active ? '  ♪ tocando' : ''}`, a.name))
        : [new Option('Nenhum app com áudio aberto', '')]),
    );
    if (atual && apps.some((a) => a.name === atual)) els.apps.value = atual;
    else if (apps.some((a) => a.name === 'Spotify.exe')) els.apps.value = 'Spotify.exe';
    marcarAppsCapturados();
  } catch {
    els.apps.replaceChildren(new Option('Capturador não encontrado (rode npm run build:capture)', ''));
  }
}

$('#capturar').addEventListener('click', () => {
  const app = els.apps.value;
  if (app && !capturando.some((c) => c.app === app)) api.capturar(app);
});
$('#recarregar').addEventListener('click', carregarApps);

// --- YouTube -----------------------------------------------------------

function renderYoutube(estado) {
  yt = estado;
  ytRecebidoEm = performance.now();
  const faixa = estado.fila[estado.atual];
  els.ytTitulo.textContent = estado.carregando ? 'Carregando link…' : faixa ? faixa.title : 'Nada tocando';
  els.ytPausar.textContent = faixa && !estado.pausado ? '⏸' : '▶';
  const repetir = REPETIR[estado.repetir];
  els.ytRepetir.textContent = repetir.icone;
  els.ytRepetir.title = repetir.titulo;
  els.ytRepetir.classList.toggle('ativo', estado.repetir !== 'nenhum');
  els.ytVolume.value = Math.round(estado.volume * 100);
  els.ytVolume.nextElementSibling.textContent = `${els.ytVolume.value}%`;

  els.ytFila.replaceChildren(
    ...estado.fila.map((f, i) =>
      el(
        'li',
        { className: i === estado.atual ? 'atual' : '', title: f.url, onclick: () => api.yt.tocar(i) },
        el('span', { className: 'num', textContent: i === estado.atual ? '♪' : String(i + 1) }),
        el('span', { className: 'nome', textContent: f.title }),
        el('span', { className: 'dur', textContent: tempo(f.duration) }),
        el('button', {
          className: 'ghost icone',
          textContent: '✕',
          title: 'Remover da fila',
          onclick: (e) => {
            e.stopPropagation();
            api.yt.remover(i);
          },
        }),
      ),
    ),
  );
  atualizarTempo();
}

// A posição vem do processo principal só quando algo muda; entre uma atualização e outra contamos aqui.
function atualizarTempo() {
  const faixa = yt?.fila[yt.atual];
  if (!faixa) return (els.ytTempo.textContent = '');
  const passado = yt.pausado ? 0 : (performance.now() - ytRecebidoEm) / 1000;
  const posicao = Math.min(yt.posicao + passado, faixa.duration ?? Infinity);
  els.ytTempo.textContent = faixa.duration ? `${tempo(posicao)} / ${tempo(faixa.duration)}` : tempo(posicao);
}
setInterval(atualizarTempo, 500);

$('#yt-form').addEventListener('submit', (e) => {
  e.preventDefault();
  api.yt.adicionar(els.ytUrl.value.trim());
  els.ytUrl.value = '';
});
els.ytPausar.addEventListener('click', () => api.yt.pausar());
$('#yt-proxima').addEventListener('click', () => api.yt.proxima());
$('#yt-anterior').addEventListener('click', () => api.yt.anterior());
$('#yt-parar').addEventListener('click', () => api.yt.parar());
$('#yt-limpar').addEventListener('click', () => api.yt.limpar());
els.ytRepetir.addEventListener('click', () => api.yt.repetir(REPETIR[yt?.repetir ?? 'nenhum'].proximo));

// --- Mixer -------------------------------------------------------------

// --- Monitor (seu fone) ----------------------------------------------

const monitor = { ctx: null, node: null, gain: null };

async function iniciarMonitor(deviceId) {
  monitor.ctx = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
  await monitor.ctx.audioWorklet.addModule('monitor-worklet.js');
  monitor.node = new AudioWorkletNode(monitor.ctx, 'monitor', { outputChannelCount: [2] });
  monitor.gain = monitor.ctx.createGain();
  monitor.node.connect(monitor.gain).connect(monitor.ctx.destination);
  await escolherSaida(deviceId);
  api.onPcm((pcm) => {
    // Copia para um ArrayBuffer próprio e transfere para o worklet sem cópia extra.
    const amostras = new Int16Array(pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength));
    monitor.node.port.postMessage(amostras.buffer, [amostras.buffer]);
  });
}

async function escolherSaida(deviceId) {
  try {
    await monitor.ctx.setSinkId(deviceId === 'default' ? '' : deviceId);
  } catch {
    mostrarErro('Não consegui usar esse dispositivo de saída; voltando para o padrão.');
    await monitor.ctx.setSinkId('');
  }
}

async function carregarSaidas(atual) {
  const select = $('#monitor-saida');
  const saidas = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audiooutput');
  select.replaceChildren(
    ...saidas.map((d) => new Option(d.deviceId === 'default' ? 'Saída padrão do Windows' : d.label || 'Dispositivo sem nome', d.deviceId)),
  );
  select.value = saidas.some((d) => d.deviceId === atual) ? atual : 'default';
}

$('#monitor-modo').addEventListener('change', (e) => api.monitor(e.target.value));
$('#monitor-saida').addEventListener('change', (e) => {
  escolherSaida(e.target.value);
  api.monitorSaida(e.target.value);
});
navigator.mediaDevices.addEventListener('devicechange', () => carregarSaidas($('#monitor-saida').value));

function renderMixer(settings) {
  $('#monitor-modo').value = settings.monitor;
  if (monitor.gain) monitor.gain.gain.value = settings.monitorVolume;
  for (const input of document.querySelectorAll('[data-volume]')) {
    const chave = input.dataset.volume;
    if (!(chave in settings)) continue;
    input.value = Math.round(settings[chave] * 100);
    input.nextElementSibling.textContent = `${input.value}%`;
  }
}

for (const input of document.querySelectorAll('[data-volume]')) {
  input.addEventListener('input', () => {
    input.nextElementSibling.textContent = `${input.value}%`;
    api.volume(input.dataset.volume, input.value / 100);
    if (input.dataset.volume === 'monitorVolume' && monitor.gain) monitor.gain.gain.value = input.value / 100;
  });
}

// --- Soundboard --------------------------------------------------------

function renderSons(sons) {
  if (sons.length === 0) {
    els.sons.replaceChildren(
      el('p', { className: 'vazio', textContent: 'Nenhum som ainda. Clique em "Abrir pasta" e coloque seus efeitos lá (mp3, ogg, wav…).' }),
    );
    return;
  }
  els.sons.replaceChildren(
    ...sons.map((arquivo, i) => {
      const botao = el(
        'button',
        { title: arquivo },
        el('span', { className: 'nome', textContent: arquivo.replace(/\.[^.]+$/, '').replace(/^\d+[\s._-]*/, '') }),
      );
      if (i < 9) botao.append(el('kbd', { textContent: `Ctrl+Alt+${i + 1}` }));
      const tocar = (previa) => {
        api.som(arquivo, previa);
        botao.classList.add(previa ? 'flash-previa' : 'flash');
        setTimeout(() => botao.classList.remove('flash', 'flash-previa'), 200);
      };
      botao.addEventListener('click', () => tocar(false));
      botao.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        tocar(true);
      });
      return botao;
    }),
  );
}

$('#parar-efeitos').addEventListener('click', () => api.pararEfeitos());
$('#abrir-sons').addEventListener('click', () => api.abrirSons());

// Ao voltar para a janela, relê a pasta de sons (você pode ter adicionado arquivos).
window.addEventListener('focus', async () => renderSons((await api.estado()).sons));

// --- Início ------------------------------------------------------------

api.onBot(renderBot);
api.onCapturas(renderCapturas);
api.onYoutube(renderYoutube);
api.onMixer(renderMixer);
api.onErro(mostrarErro);

(async () => {
  const estado = await api.estado();
  renderBot(estado.bot);
  renderCapturas(estado.capturas);
  renderYoutube(estado.youtube);
  await iniciarMonitor(estado.monitorDevice);
  renderMixer(estado.mixer);
  carregarSaidas(estado.monitorDevice);
  renderSons(estado.sons);
  els.api.textContent = `http://127.0.0.1:${estado.apiPort}/api/som/1`;
  carregarApps();
})();
