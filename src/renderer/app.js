// Interface do Mestrônomo. Conversa com o processo principal via window.mestronomo (preload).
const api = window.mestronomo;
const $ = (sel) => document.querySelector(sel);

const els = {
  bot: $('#bot'),
  apps: $('#apps'),
  capturar: $('#capturar'),
  capturaStatus: $('#captura-status'),
  sons: $('#sons'),
  erro: $('#erro'),
  api: $('#api'),
};

let capturando = null;
let erroTimer;

function mostrarErro(msg) {
  els.erro.textContent = msg ?? '';
  clearTimeout(erroTimer);
  if (msg) erroTimer = setTimeout(() => (els.erro.textContent = ''), 8000);
}

function renderBot(status) {
  const textos = {
    desligado: ['off', status.motivo ?? 'Bot desligado'],
    conectando: ['warn', 'Conectando ao Discord…'],
    aguardando: ['warn', `${status.bot} · entre num canal de voz`],
    'no-canal': ['ok', `${status.bot} · ${status.servidor} › ${status.canal}`],
  };
  const [classe, texto] = textos[status.state];
  els.bot.className = `pill ${classe}`;
  els.bot.textContent = texto;
}

function renderCaptura({ app, erro }) {
  capturando = app ?? null;
  els.capturar.textContent = capturando ? 'Parar' : 'Capturar';
  els.capturar.classList.toggle('parar', Boolean(capturando));
  els.apps.disabled = Boolean(capturando);
  els.capturaStatus.className = `status ${capturando ? 'on' : erro ? 'err' : ''}`;
  els.capturaStatus.textContent = capturando ? `Transmitindo ${capturando}` : erro ? `A captura parou: ${erro}` : '';
}

function renderMixer(settings) {
  for (const input of document.querySelectorAll('[data-volume]')) {
    const valor = Math.round(settings[input.dataset.volume] * 100);
    input.value = valor;
    input.nextElementSibling.textContent = `${valor}%`;
  }
}

function renderSons(sons) {
  els.sons.replaceChildren();
  if (sons.length === 0) {
    const vazio = document.createElement('p');
    vazio.className = 'vazio';
    vazio.textContent = 'Nenhum som ainda. Clique em "Abrir pasta" e coloque seus efeitos lá (mp3, ogg, wav…).';
    els.sons.append(vazio);
    return;
  }
  sons.forEach((arquivo, i) => {
    const botao = document.createElement('button');
    const nome = document.createElement('span');
    nome.className = 'nome';
    nome.textContent = arquivo.replace(/\.[^.]+$/, '').replace(/^\d+[\s._-]*/, '');
    botao.append(nome);
    if (i < 9) {
      const atalho = document.createElement('kbd');
      atalho.textContent = `Ctrl+Alt+${i + 1}`;
      botao.append(atalho);
    }
    botao.title = arquivo;
    botao.addEventListener('click', () => {
      api.som(arquivo);
      botao.classList.add('flash');
      setTimeout(() => botao.classList.remove('flash'), 200);
    });
    els.sons.append(botao);
  });
}

async function carregarApps() {
  const atual = els.apps.value || capturando;
  els.apps.replaceChildren(new Option('Carregando…', ''));
  try {
    const apps = await api.apps();
    els.apps.replaceChildren(
      ...(apps.length ? apps : [{ name: '', active: false }]).map((a) =>
        a.name ? new Option(`${a.name}${a.active ? '  ♪ tocando' : ''}`, a.name) : new Option('Nenhum app com áudio aberto', ''),
      ),
    );
    if (atual && apps.some((a) => a.name === atual)) els.apps.value = atual;
    else if (apps.some((a) => a.name === 'Spotify.exe')) els.apps.value = 'Spotify.exe';
  } catch (err) {
    els.apps.replaceChildren(new Option('Capturador não encontrado (rode npm run build:capture)', ''));
  }
}

els.capturar.addEventListener('click', () => {
  if (capturando) return api.captura(null);
  if (els.apps.value) api.captura(els.apps.value);
});
$('#recarregar').addEventListener('click', carregarApps);
$('#parar-efeitos').addEventListener('click', () => api.pararEfeitos());
$('#abrir-sons').addEventListener('click', () => api.abrirSons());

for (const input of document.querySelectorAll('[data-volume]')) {
  input.addEventListener('input', () => {
    input.nextElementSibling.textContent = `${input.value}%`;
    api.volume(input.dataset.volume, input.value / 100);
  });
}

// Ao voltar para a janela, relê a pasta de sons (você pode ter adicionado arquivos).
window.addEventListener('focus', async () => renderSons((await api.estado()).sons));

api.onBot(renderBot);
api.onCaptura(renderCaptura);
api.onMixer(renderMixer);
api.onErro(mostrarErro);

(async () => {
  const estado = await api.estado();
  renderBot(estado.bot);
  renderCaptura({ app: estado.captura });
  renderMixer(estado.mixer);
  renderSons(estado.sons);
  els.api.textContent = `http://127.0.0.1:${estado.apiPort}/api/som/1`;
  carregarApps();
})();
