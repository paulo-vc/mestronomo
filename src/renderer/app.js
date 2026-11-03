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

function mostrarErro(msg, tipo = 'erro') {
  els.erro.textContent = msg ?? '';
  els.erro.className = tipo;
  clearTimeout(erroTimer);
  if (msg) erroTimer = setTimeout(() => (els.erro.textContent = ''), 8000);
}

/** Substitui o prompt() (que o Electron não suporta): pede um texto num diálogo. */
function pedirTexto(titulo, valor = '') {
  const dialogo = $('#pergunta');
  const form = $('#pergunta-form');
  $('#pergunta-titulo').textContent = titulo;
  form.texto.value = valor;
  dialogo.showModal();
  form.texto.select();
  return new Promise((resolve) => {
    dialogo.addEventListener('close', () => resolve(dialogo.returnValue === 'ok' ? form.texto.value.trim() : null), { once: true });
  });
}

// --- Navegação ---------------------------------------------------------

const PAGINAS = ['roteiro', 'cenas', 'musica', 'ambiente', 'soundboard', 'mesa', 'audio'];

function irPara(pagina) {
  if (!PAGINAS.includes(pagina)) pagina = 'roteiro';
  for (const p of document.querySelectorAll('.pagina')) p.classList.toggle('ativa', p.dataset.pagina === pagina);
  for (const b of document.querySelectorAll('.menu button')) b.classList.toggle('ativo', b.dataset.ir === pagina);
  $('.conteudo').scrollTop = 0;
  try {
    localStorage.setItem('pagina', pagina);
  } catch {}
}

for (const b of document.querySelectorAll('.menu button')) b.addEventListener('click', () => irPara(b.dataset.ir));
// Ctrl+1..7 troca de página (com a janela em foco; os atalhos globais usam Ctrl+Alt).
window.addEventListener('keydown', (e) => {
  if (!e.ctrlKey || e.altKey || e.shiftKey) return;
  const i = Number(e.key) - 1;
  if (i >= 0 && i < PAGINAS.length) {
    e.preventDefault();
    irPara(PAGINAS[i]);
  }
});
try {
  irPara(localStorage.getItem('pagina') || 'roteiro');
} catch {
  irPara('roteiro');
}

// --- Barra fixa ----------------------------------------------------------

const barra = { cena: undefined, camadas: 0 };

function renderBarra() {
  const faixa = yt?.fila[yt.atual];
  $('#barra-titulo').textContent = yt?.carregando && !faixa ? 'Carregando…' : faixa ? faixa.title : 'Nada tocando';
  $('#barra-pausar').textContent = faixa && !yt.pausado ? '⏸' : '▶';
  const partes = [];
  if (barra.cena) partes.push(`Cena: ${barra.cena}`);
  if (barra.camadas) partes.push(`${barra.camadas} camada${barra.camadas > 1 ? 's' : ''} de ambiente`);
  if (capturando.length) partes.push(`${capturando.map((c) => c.app.replace(/\.exe$/i, '')).join(', ')} ao vivo`);
  $('#barra-sub').textContent = partes.join(' · ');
}

$('#barra-pausar').addEventListener('click', () => api.yt.pausar());
$('#barra-proxima').addEventListener('click', () => api.yt.proxima());

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
  // Sem bot configurado, o botão principal leva direto à configuração.
  const semConfig = status.state === 'desligado';
  els.bot.className = `pill ${classe}`;
  els.bot.textContent = texto;
  botNoCanal = status.state === 'no-canal';
  els.botBotao.textContent = semConfig ? 'Configurar bot' : botNoCanal ? 'Dispensar bot' : 'Chamar bot';
  els.botBotao.classList.toggle('primary', !botNoCanal);
  els.botBotao.disabled = status.state === 'conectando';
}

els.botBotao.addEventListener('click', () => {
  if (els.botBotao.textContent === 'Configurar bot') return abrirConfig();
  botNoCanal ? api.botSair() : api.botEntrar();
});

// --- Handout -------------------------------------------------------------

const dialogoHandout = $('#handout');
$('#abrir-handout').addEventListener('click', () => dialogoHandout.showModal());
dialogoHandout.addEventListener('close', async () => {
  if (dialogoHandout.returnValue !== 'enviar') return;
  const form = $('#handout-form');
  if (await api.handout(form.legenda.value)) form.legenda.value = '';
});

// --- Atualização ---------------------------------------------------------

function renderAtualizacao(s) {
  const botao = $('#atualizacao');
  const textos = {
    baixando: () => `Baixando ${s.versao}… ${s.progresso}%`,
    pronta: () => `Atualização ${s.versao} pronta — reiniciar`,
    disponivel: () => `Versão ${s.versao} disponível — baixar`,
  };
  botao.classList.toggle('hidden', !textos[s.estado]);
  if (textos[s.estado]) botao.textContent = textos[s.estado]();
  botao.disabled = s.estado === 'baixando';
}
$('#atualizacao').addEventListener('click', () => api.atualizar());

// --- Configurações -------------------------------------------------------

const dialogo = $('#config');
const configForm = $('#config-form');

function mostrarCheck(texto, classe = '') {
  const check = $('#bot-check');
  check.textContent = texto;
  check.className = `hint ${classe}`;
}

async function abrirConfig() {
  const info = await api.configInfo();
  mostrarCheck(info.hasToken ? 'Token salvo e guardado criptografado neste PC.' : 'Fica guardado criptografado neste PC.');
  configForm.token.value = '';
  configForm.token.placeholder = info.hasToken ? '•••••••• (salvo; deixe vazio para manter)' : 'Cole o token aqui';
  configForm.ownerId.value = info.ownerId ?? '';
  configForm.autoStart.checked = info.autoStart;
  configForm.tocandoAgora.checked = info.tocandoAgora;
  $('#config-canal').textContent = info.canalTexto
    ? 'Canal de texto definido. Para trocar, use /canal no canal desejado.'
    : 'Para "tocando agora" e handouts, use /canal no canal de texto desejado.';
  configForm.token.disabled = configForm.ownerId.disabled = info.fromEnv;
  $('#bot-verificar').disabled = info.fromEnv;
  $('#config-env').classList.toggle('hidden', !info.fromEnv);
  dialogo.showModal();
}

$('#abrir-config').addEventListener('click', abrirConfig);
$('#bot-portal').addEventListener('click', () => api.botPortal());
$('#backup-exportar').addEventListener('click', () => api.backupExportar($('#backup-arquivos').checked));
$('#backup-importar').addEventListener('click', () => api.backupImportar());
$('#bot-convidar').addEventListener('click', () => api.botConvidar(configForm.token.value));
$('#bot-verificar').addEventListener('click', async () => {
  const token = configForm.token.value.trim();
  if (!token) return mostrarCheck('Cole o token primeiro.', 'err');
  mostrarCheck('Verificando…');
  const r = await api.botVerificar(token);
  if (!r.ok) return mostrarCheck(r.erro, 'err');
  mostrarCheck(`✓ Bot "${r.bot}" encontrado${r.dono ? ` · dono: ${r.dono}` : ''}. Agora convide e clique em Salvar.`, 'ok');
});
dialogo.addEventListener('close', () => {
  if (dialogo.returnValue !== 'salvar') return;
  api.configSalvar(configForm.token.value, configForm.ownerId.value, configForm.autoStart.checked, configForm.tocandoAgora.checked);
  configForm.token.value = '';
});

// --- Capturas ----------------------------------------------------------

function renderCapturas(lista) {
  capturando = lista;
  renderBarra();
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
  renderBarra();
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

// Link → adiciona direto; texto → busca e mostra os 5 primeiros para escolher.
$('#yt-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const texto = els.ytUrl.value.trim();
  if (/^https?:\/\//i.test(texto)) {
    api.yt.adicionar(texto);
    els.ytUrl.value = '';
    return $('#yt-resultados').replaceChildren();
  }
  const resultados = await api.yt.buscar(texto);
  $('#yt-resultados').replaceChildren(
    ...resultados.map((faixa) =>
      el(
        'li',
        {
          title: 'Pôr na fila',
          onclick: () => {
            api.yt.adicionarFaixa(faixa);
            els.ytUrl.value = '';
            $('#yt-resultados').replaceChildren();
          },
        },
        el('span', { className: 'nome', textContent: faixa.title }),
        el('span', { className: 'detalhe', textContent: tempo(faixa.duration) }),
        el('span', { className: 'detalhe', textContent: '+' }),
      ),
    ),
  );
  if (resultados.length === 0) mostrarErro('Nada encontrado.');
});

async function carregarPlaylists() {
  const pastas = await api.yt.playlists();
  $('#playlists').replaceChildren(
    ...(pastas.length ? pastas.map((p) => new Option(p, p)) : [new Option('Nenhuma pasta em musicas/', '')]),
  );
}
$('#playlist-carregar').addEventListener('click', () => {
  const pasta = $('#playlists').value;
  if (pasta) api.yt.carregarPasta(pasta);
});
$('#playlist-pasta').addEventListener('click', () => api.yt.abrirPasta());
window.addEventListener('focus', carregarPlaylists);
els.ytPausar.addEventListener('click', () => api.yt.pausar());
$('#yt-proxima').addEventListener('click', () => api.yt.proxima());
$('#yt-anterior').addEventListener('click', () => api.yt.anterior());
$('#yt-parar').addEventListener('click', () => api.yt.parar());
$('#yt-limpar').addEventListener('click', () => api.yt.limpar());
els.ytRepetir.addEventListener('click', () => api.yt.repetir(REPETIR[yt?.repetir ?? 'nenhum'].proximo));

// --- Cenas -------------------------------------------------------------

function renderCenas(estado) {
  barra.cena = estado.cenas.find((c) => c.id === estado.ativa)?.nome;
  renderBarra();
  $('#cenas-lista').replaceChildren(
    ...estado.cenas.map((c, i) =>
      el(
        'button',
        { className: `cena${c.id === estado.ativa ? ' ativa' : ''}`, title: `Ativar (API: /api/cena/${i + 1})`, onclick: () => api.cenas.ativar(c.id) },
        el('span', { className: 'nome', textContent: c.nome }),
        el('span', { className: 'resumo', textContent: c.resumo }),
        el('span', {
          className: 'remover',
          textContent: '✕',
          title: 'Apagar cena',
          onclick: (e) => {
            e.stopPropagation();
            if (confirm(`Apagar a cena "${c.nome}"?`)) api.cenas.remover(c.id);
          },
        }),
      ),
    ),
  );
  const fade = $('#cena-fade');
  fade.value = estado.fadeMs / 1000;
  fade.nextElementSibling.textContent = `${fade.value} s`;
}

$('#cena-form').addEventListener('submit', (e) => {
  e.preventDefault();
  api.cenas.salvar(e.target.nome.value, e.target.musica.value);
  e.target.nome.value = '';
});
$('#cena-fade').addEventListener('input', (e) => {
  e.target.nextElementSibling.textContent = `${e.target.value} s`;
  api.cenas.fade(e.target.value * 1000);
});

// --- Ambiente ----------------------------------------------------------

const semExtensao = (arquivo) => arquivo.replace(/\.[^.]+$/, '');

function renderAmbiente(estado) {
  barra.camadas = estado.camadas.length;
  renderBarra();
  const ativas = new Set(estado.camadas.map((c) => c.arquivo));
  $('#amb-arquivos').replaceChildren(
    ...estado.arquivos.map((arquivo) =>
      el('button', {
        className: ativas.has(arquivo) ? 'ativo' : '',
        textContent: semExtensao(arquivo),
        title: ativas.has(arquivo) ? 'Desligar' : 'Ligar',
        onclick: () => api.amb.alternar(arquivo),
      }),
    ),
  );
  $('#amb-camadas').replaceChildren(
    ...estado.camadas.map(({ arquivo, volume }) =>
      el(
        'li',
        {},
        el('span', { className: 'nome', textContent: semExtensao(arquivo) }),
        ...slider(volume, (v) => api.amb.volume(arquivo, v)),
        el('button', { className: 'ghost icone', textContent: '✕', title: 'Desligar', onclick: () => api.amb.alternar(arquivo) }),
      ),
    ),
  );
  $('#amb-ocasionais').replaceChildren(
    ...estado.ocasionais.map((o) =>
      el(
        'li',
        { className: 'ocasional' },
        el('span', { className: 'nome', textContent: o.arquivos.map(semExtensao).join(', '), title: o.arquivos.join('\n') }),
        el('span', { className: 'detalhe', textContent: `a cada ${o.min}–${o.max} s` }),
        el('button', { className: 'ghost icone', textContent: '✕', title: 'Remover', onclick: () => api.amb.removerOcasional(o.id) }),
      ),
    ),
  );
  // Preserva a seleção do formulário ao re-renderizar.
  const select = $('#amb-ocasional-form').arquivos;
  const selecionados = new Set([...select.selectedOptions].map((o) => o.value));
  select.replaceChildren(...estado.arquivos.map((a) => new Option(semExtensao(a), a, false, selecionados.has(a))));
}

$('#amb-pasta').addEventListener('click', () => api.amb.abrirPasta());
$('#amb-parar').addEventListener('click', () => api.amb.parar());
$('#amb-ocasional-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const form = e.target;
  const arquivos = [...form.arquivos.selectedOptions].map((o) => o.value);
  if (arquivos.length === 0) return mostrarErro('Escolha pelo menos um arquivo (Ctrl+clique para vários).');
  api.amb.ocasional({ arquivos, min: Number(form.min.value), max: Number(form.max.value), volume: 0.8 });
  form.arquivos.selectedIndex = -1;
});

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

const CORES = ['', '#d9605a', '#e0b04a', '#5fbf85', '#5a9bd9', '#a77bd9', '#d97bb4'];
let soundboard = { categorias: [], sons: [], loops: [] };
let categoria = 'Todos';
try {
  categoria = localStorage.getItem('categoria') || 'Todos';
} catch {}

function renderSoundboard(estado) {
  soundboard = estado;
  if (categoria !== 'Todos' && !estado.categorias.includes(categoria)) categoria = 'Todos';
  const abas = estado.categorias.length > 1 ? ['Todos', ...estado.categorias] : [];
  $('#sons-abas').replaceChildren(
    ...abas.map((c) =>
      el('button', {
        className: c === categoria ? 'ativo' : '',
        textContent: c,
        onclick: () => {
          categoria = c;
          try {
            localStorage.setItem('categoria', c);
          } catch {}
          renderSoundboard(soundboard);
        },
      }),
    ),
  );

  if (estado.sons.length === 0) {
    els.sons.replaceChildren(
      el('p', {
        className: 'vazio',
        textContent: 'Nenhum som ainda. Clique em "Abrir pasta" e coloque seus efeitos lá. Subpastas viram categorias.',
      }),
    );
    return;
  }
  const loops = new Set(estado.loops);
  els.sons.replaceChildren(
    ...estado.sons
      .map((som, i) => ({ som, i }))
      .filter(({ som }) => categoria === 'Todos' || som.categoria === categoria)
      .map(({ som, i }) => {
        const botao = el(
          'button',
          { title: som.arquivos.length > 1 ? `${som.arquivos.length} variações, sorteadas a cada clique` : som.arquivos[0] },
          el('span', { className: 'nome', textContent: som.nome }),
        );
        const detalhes = el('span', { className: 'detalhes' });
        if (i < 9) detalhes.append(el('kbd', { textContent: `Ctrl+Alt+${i + 1}` }));
        if (som.arquivos.length > 1) detalhes.append(el('span', { className: 'tag', textContent: `×${som.arquivos.length}` }));
        if (som.loop) detalhes.append(el('span', { className: 'tag', textContent: '↻ loop' }));
        if (som.volume < 1) detalhes.append(el('span', { className: 'tag', textContent: `${Math.round(som.volume * 100)}%` }));
        botao.append(detalhes);
        botao.append(
          el('span', {
            className: 'opcoes',
            textContent: '⋯',
            title: 'Volume, loop e cor',
            onclick: (e) => {
              e.stopPropagation();
              abrirOpcoesSom(som);
            },
          }),
        );
        if (som.cor) botao.style.setProperty('--cor', som.cor);
        botao.classList.toggle('com-cor', Boolean(som.cor));
        botao.classList.toggle('em-loop', loops.has(som.id));
        const tocar = (previa) => {
          api.som(som.id, previa);
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

const dialogoSom = $('#som-opcoes');
const formSom = $('#som-opcoes-form');
let somEditado = null;

function abrirOpcoesSom(som) {
  somEditado = som;
  $('#som-opcoes-titulo').textContent = som.nome;
  $('#som-opcoes-arquivos').textContent = som.arquivos.join(' · ');
  formSom.volume.value = Math.round(som.volume * 100);
  formSom.volume.nextElementSibling.textContent = `${formSom.volume.value}%`;
  formSom.loop.checked = som.loop;
  $('#som-cores').replaceChildren(
    ...CORES.map((cor) => {
      const botao = el('button', {
        type: 'button',
        className: `cor${(som.cor ?? '') === cor ? ' ativo' : ''}`,
        title: cor || 'Sem cor',
        onclick: () => {
          api.somOpcoes(som.id, { cor: cor || undefined });
          for (const b of $('#som-cores').children) b.classList.toggle('ativo', b === botao);
        },
      });
      if (cor) botao.style.setProperty('--cor', cor);
      return botao;
    }),
  );
  dialogoSom.showModal();
}

formSom.volume.addEventListener('input', (e) => {
  e.target.nextElementSibling.textContent = `${e.target.value}%`;
  if (somEditado) api.somOpcoes(somEditado.id, { volume: e.target.value / 100 });
});
formSom.loop.addEventListener('change', (e) => {
  if (somEditado) api.somOpcoes(somEditado.id, { loop: e.target.checked });
});

$('#parar-efeitos').addEventListener('click', () => api.pararEfeitos());
$('#abrir-sons').addEventListener('click', () => api.abrirSons());

// Ao voltar para a janela, relê a pasta de sons (você pode ter adicionado arquivos).
window.addEventListener('focus', async () => renderSoundboard((await api.estado()).soundboard));

// --- Mesa: iniciativa, timers e tabelas -----------------------------------

let abaMesa = 'iniciativa';
try {
  abaMesa = localStorage.getItem('abaMesa') || 'iniciativa';
} catch {}

function mostrarAbaMesa(aba) {
  abaMesa = aba;
  for (const b of document.querySelectorAll('#mesa-abas button')) b.classList.toggle('ativo', b.dataset.aba === aba);
  for (const p of document.querySelectorAll('[data-painel]')) p.classList.toggle('hidden', p.dataset.painel !== aba);
  try {
    localStorage.setItem('abaMesa', aba);
  } catch {}
}
for (const b of document.querySelectorAll('#mesa-abas button')) b.addEventListener('click', () => mostrarAbaMesa(b.dataset.aba));
mostrarAbaMesa(abaMesa);

// Iniciativa

let combate = null;

function renderCombate(estado) {
  combate = estado;
  $('#combate-status').textContent = estado.ativo
    ? `Rodada ${estado.rodada} · vez de ${estado.combatentes[estado.turno]?.nome ?? '—'}`
    : 'Fora de combate';
  $('#combate-status').classList.toggle('on', estado.ativo);
  $('#combate-iniciar').classList.toggle('hidden', estado.ativo);
  for (const id of ['#combate-anterior', '#combate-proximo', '#combate-encerrar']) $(id).classList.toggle('hidden', !estado.ativo);
  $('#combate-cena').value = estado.cenaCombate ?? '';

  $('#combatentes').replaceChildren(
    ...estado.combatentes.map((c, i) => {
      const hp = el('input', {
        type: 'text',
        className: 'hp',
        placeholder: 'HP',
        value: c.hp ?? '',
        title: '-7 dano · +5 cura · 30 define',
      });
      hp.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        api.combate.hp(c.id, hp.value);
        hp.blur();
      });
      const iniciativa = el('input', { type: 'number', className: 'init', value: c.iniciativa, title: 'Iniciativa' });
      iniciativa.addEventListener('change', () => api.combate.iniciativa(c.id, Number(iniciativa.value)));
      const baixo = c.hp !== undefined && c.hpMax ? c.hp / c.hpMax : 1;
      return el(
        'li',
        { className: `${estado.ativo && i === estado.turno ? 'atual' : ''}${c.jogador ? ' jogador' : ''}${c.hp !== undefined && c.hp <= 0 ? ' caido' : ''}` },
        iniciativa,
        el('span', { className: 'nome', textContent: c.nome }),
        el(
          'span',
          { className: 'hp-box' },
          hp,
          el('span', { className: `hp-max${baixo <= 0.25 ? ' perigo' : ''}`, textContent: c.hpMax ? `/ ${c.hpMax}` : '' }),
        ),
        el('button', { className: 'ghost icone', textContent: '✕', title: 'Remover', onclick: () => api.combate.remover(c.id) }),
      );
    }),
  );
}

function preencherCenasCombate(cenas) {
  const select = $('#combate-cena');
  const atual = combate?.cenaCombate ?? '';
  select.replaceChildren(new Option('Sem trocar de cena', ''), ...cenas.cenas.map((c) => new Option(`Cena: ${c.nome}`, c.id)));
  select.value = atual;
}

$('#combate-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const f = e.target;
  api.combate.add({
    nome: f.nome.value,
    iniciativa: f.iniciativa.value === '' ? undefined : Number(f.iniciativa.value),
    modificador: Number(f.modificador.value) || 0,
    hp: f.hp.value === '' ? undefined : Number(f.hp.value),
    jogador: f.jogador.checked,
  });
  f.nome.value = f.iniciativa.value = f.modificador.value = f.hp.value = '';
  f.nome.focus();
});
$('#combate-iniciar').addEventListener('click', () => api.combate.iniciar());
$('#combate-proximo').addEventListener('click', () => api.combate.proximo());
$('#combate-anterior').addEventListener('click', () => api.combate.anterior());
$('#combate-encerrar').addEventListener('click', () => api.combate.encerrar());
$('#combate-limpar').addEventListener('click', () => api.combate.limpar());
$('#combate-cena').addEventListener('change', (e) => api.combate.cena(e.target.value));
$('#combate-anunciar').addEventListener('change', (e) => api.combate.anunciar(e.target.checked));

// Timers

let timers = [];

function renderTimers(lista) {
  timers = lista;
  $('#timers').replaceChildren(
    ...lista.map((t) => {
      const item = el(
        'li',
        { className: 'timer' },
        el('span', { className: 'nome', textContent: t.nome }),
        el('span', { className: 'contagem' }),
        el('button', { className: 'ghost icone', textContent: t.fim ? '⏸' : '▶', title: t.fim ? 'Pausar' : 'Continuar', onclick: () => api.timers.pausar(t.id) }),
        el('button', { className: 'ghost icone', textContent: '✕', title: 'Remover', onclick: () => api.timers.remover(t.id) }),
      );
      item.dataset.id = t.id;
      return item;
    }),
  );
  atualizarContagens();
}

function atualizarContagens() {
  for (const t of timers) {
    const span = document.querySelector(`.timer[data-id="${t.id}"] .contagem`);
    if (!span) continue;
    const restante = t.fim ? Math.max(0, (t.fim - Date.now()) / 1000) : (t.restante ?? t.total);
    span.textContent = tempo(Math.ceil(restante)) + (t.fim ? '' : ' (pausado)');
  }
}
setInterval(atualizarContagens, 250);

function preencherSonsTimer(estadoSoundboard) {
  const select = $('#timer-form').som;
  const atual = select.value;
  select.replaceChildren(new Option('Sem som', ''), ...estadoSoundboard.sons.map((s) => new Option(`🔔 ${s.id}`, s.id)));
  select.value = atual;
}

$('#timer-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const f = e.target;
  const segundos = (Number(f.min.value) || 0) * 60 + (Number(f.seg.value) || 0);
  if (segundos <= 0) return mostrarErro('Defina um tempo maior que zero.');
  api.timers.add(f.nome.value, segundos, f.som.value);
  f.nome.value = '';
});

// Tabelas

let ultimoResultado = null;

async function carregarTabelas() {
  const nomes = await api.tabelas.listar();
  const select = $('#tabelas');
  const atual = select.value;
  select.replaceChildren(...(nomes.length ? nomes.map((n) => new Option(n, n)) : [new Option('Nenhuma tabela em tabelas/', '')]));
  if (nomes.includes(atual)) select.value = atual;
}

$('#tabela-rolar').addEventListener('click', async () => {
  const nome = $('#tabelas').value;
  if (!nome) return;
  ultimoResultado = await api.tabelas.rolar(nome);
  if (!ultimoResultado) return;
  $('#tabela-texto').textContent = ultimoResultado.texto;
  $('#tabela-resultado').classList.remove('hidden');
});
$('#tabela-discord').addEventListener('click', () => {
  if (ultimoResultado) api.discordTexto(`🎲 **${ultimoResultado.tabela}**: ${ultimoResultado.texto}`);
});
$('#tabelas-pasta').addEventListener('click', () => api.tabelas.abrirPasta());
window.addEventListener('focus', carregarTabelas);

// --- Roteiro -------------------------------------------------------------

let roteiro = { roteiros: [], indice: -1 };
let handoutsUrl = '';
let cenasConhecidas = [];
let momentoEditado = null;
let imagemEditada = null;

const roteiroAtivo = () => roteiro.roteiros.find((r) => r.id === roteiro.ativo);

function renderRoteiro(estado) {
  roteiro = estado;
  const ativo = roteiroAtivo();
  const select = $('#roteiro-select');
  select.replaceChildren(
    ...(estado.roteiros.length ? estado.roteiros.map((r) => new Option(r.nome, r.id)) : [new Option('Nenhum roteiro — clique em + Novo', '')]),
  );
  select.value = estado.ativo ?? '';
  for (const id of ['#roteiro-renomear', '#roteiro-apagar', '#momento-novo']) $(id).disabled = !ativo;

  const momentos = ativo?.momentos ?? [];
  $('#momentos').replaceChildren(
    ...momentos.map((m, i) =>
      el(
        'li',
        { className: i === estado.indice ? 'atual' : '', title: 'Ir para este momento', onclick: () => api.roteiro.ir(i) },
        el('span', { className: 'num', textContent: String(i + 1) }),
        el('span', { className: 'nome', textContent: m.titulo }),
        el(
          'span',
          { className: 'acoes' },
          botaoIcone('↑', 'Subir', () => api.roteiro.moverMomento(m.id, -1)),
          botaoIcone('↓', 'Descer', () => api.roteiro.moverMomento(m.id, 1)),
          botaoIcone('✎', 'Editar', () => abrirMomento(m)),
          botaoIcone('✕', 'Apagar', () => confirm(`Apagar o momento "${m.titulo}"?`) && api.roteiro.removerMomento(m.id)),
        ),
      ),
    ),
  );

  const atual = momentos[estado.indice];
  $('#agora-vazio').classList.toggle('hidden', Boolean(atual));
  $('#agora').classList.toggle('hidden', !atual);
  $('#roteiro-comecar').disabled = momentos.length === 0;
  $('#roteiro-anterior').disabled = !atual || estado.indice === 0;
  $('#roteiro-proximo').disabled = !ativo || estado.indice >= momentos.length - 1;
  $('#roteiro-proximo').textContent = atual ? 'Próximo momento ▶' : 'Começar ▶';
  $('#momento-posicao').textContent = atual ? `${estado.indice + 1} de ${momentos.length}` : '';
  if (!atual) return;

  $('#agora-titulo').textContent = atual.titulo;
  const cena = cenasConhecidas.find((c) => c.id === atual.cena);
  $('#agora-cena').textContent = cena ? `Cena: ${cena.nome}` : '';
  $('#agora-notas').textContent = atual.notas || '';
  $('#agora-sons').replaceChildren(
    ...atual.sons.map((id) => {
      const som = soundboard.sons.find((s) => s.id === id);
      const botao = el('button', { title: id, onclick: () => api.som(id, false) }, el('span', { className: 'nome', textContent: som?.nome ?? id }));
      botao.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        api.som(id, true);
      });
      return botao;
    }),
  );
  const handout = atual.handout;
  $('#agora-handout').classList.toggle('hidden', !handout);
  if (handout) {
    $('#agora-handout-img').src = `${handoutsUrl}/${encodeURIComponent(handout.arquivo)}`;
    $('#agora-handout-legenda').textContent = handout.legenda || handout.arquivo;
  }
}

function botaoIcone(texto, titulo, acao) {
  return el('button', {
    className: 'ghost icone',
    textContent: texto,
    title: titulo,
    onclick: (e) => {
      e.stopPropagation();
      acao();
    },
  });
}

$('#roteiro-select').addEventListener('change', (e) => e.target.value && api.roteiro.selecionar(e.target.value));
$('#roteiro-novo').addEventListener('click', async () => {
  const nome = await pedirTexto('Nome do roteiro (ex.: Sessão 12 — A cripta)');
  if (nome !== null) api.roteiro.criar(nome);
});
$('#roteiro-renomear').addEventListener('click', async () => {
  const ativo = roteiroAtivo();
  const nome = ativo && (await pedirTexto('Novo nome do roteiro', ativo.nome));
  if (nome) api.roteiro.renomear(ativo.id, nome);
});
$('#roteiro-apagar').addEventListener('click', () => {
  const ativo = roteiroAtivo();
  if (ativo && confirm(`Apagar o roteiro "${ativo.nome}" e todos os momentos dele?`)) api.roteiro.remover(ativo.id);
});
$('#roteiro-comecar').addEventListener('click', () => api.roteiro.ir(0));
$('#roteiro-proximo').addEventListener('click', () => api.roteiro.proximo());
$('#roteiro-anterior').addEventListener('click', () => api.roteiro.anterior());
$('#agora-handout-enviar').addEventListener('click', () => {
  const atual = roteiroAtivo()?.momentos[roteiro.indice];
  if (atual) api.roteiro.enviarHandout(atual.id);
});
$('#momento-novo').addEventListener('click', () => abrirMomento(null));

// Editor de momento

const editor = $('#momento-editor');
const formMomento = $('#momento-form');

function abrirMomento(momento) {
  momentoEditado = momento;
  imagemEditada = momento?.handout?.arquivo ?? null;
  $('#momento-editor-titulo').textContent = momento ? 'Editar momento' : 'Novo momento';
  formMomento.titulo.value = momento?.titulo ?? '';
  formMomento.notas.value = momento?.notas ?? '';
  formMomento.cena.replaceChildren(new Option('Não trocar de cena', ''), ...cenasConhecidas.map((c) => new Option(c.nome, c.id)));
  formMomento.cena.value = momento?.cena ?? '';
  const escolhidos = new Set(momento?.sons ?? []);
  formMomento.sons.replaceChildren(...soundboard.sons.map((s) => new Option(s.id, s.id, false, escolhidos.has(s.id))));
  formMomento.legenda.value = momento?.handout?.legenda ?? '';
  mostrarImagemEditada();
  editor.showModal();
}

function mostrarImagemEditada() {
  $('#momento-imagem-nome').textContent = imagemEditada ?? 'Nenhuma imagem';
  $('#momento-imagem-tirar').classList.toggle('hidden', !imagemEditada);
}

$('#momento-imagem').addEventListener('click', async () => {
  const nome = await api.roteiro.escolherImagem();
  if (nome) {
    imagemEditada = nome;
    mostrarImagemEditada();
  }
});
$('#momento-imagem-tirar').addEventListener('click', () => {
  imagemEditada = null;
  mostrarImagemEditada();
});
editor.addEventListener('close', () => {
  if (editor.returnValue !== 'salvar') return;
  api.roteiro.salvarMomento({
    id: momentoEditado?.id,
    titulo: formMomento.titulo.value,
    notas: formMomento.notas.value,
    cena: formMomento.cena.value,
    sons: [...formMomento.sons.selectedOptions].map((o) => o.value),
    handout: imagemEditada ? { arquivo: imagemEditada, legenda: formMomento.legenda.value } : undefined,
  });
});

// --- Início ------------------------------------------------------------

api.onBot(renderBot);
api.onCapturas(renderCapturas);
api.onYoutube(renderYoutube);
api.onAmbiente(renderAmbiente);
api.onCenas((s) => {
  cenasConhecidas = s.cenas;
  renderCenas(s);
  preencherCenasCombate(s);
});
api.onSoundboard((s) => {
  renderSoundboard(s);
  preencherSonsTimer(s);
});
api.onCombate(renderCombate);
api.onTimers(renderTimers);
api.onTimerFim((t) => mostrarErro(`⏰ ${t.nome}: o tempo acabou!`));
api.onMixer(renderMixer);
api.onErro(mostrarErro);
api.onAviso((msg) => mostrarErro(msg, 'aviso'));
api.onAtualizacao(renderAtualizacao);
api.onRoteiro(renderRoteiro);

(async () => {
  const estado = await api.estado();
  renderBot(estado.bot);
  renderAtualizacao(estado.atualizacao);
  handoutsUrl = estado.handoutsUrl;
  cenasConhecidas = estado.cenas.cenas;
  $('#versao').textContent = `Mestrônomo ${estado.versao}`;
  renderCapturas(estado.capturas);
  renderYoutube(estado.youtube);
  renderAmbiente(estado.ambiente);
  renderCenas(estado.cenas);
  await iniciarMonitor(estado.monitorDevice);
  renderMixer(estado.mixer);
  carregarSaidas(estado.monitorDevice);
  renderSoundboard(estado.soundboard);
  preencherSonsTimer(estado.soundboard);
  renderCombate(estado.combate);
  preencherCenasCombate(estado.cenas);
  $('#combate-anunciar').checked = estado.anunciarTurnos;
  renderTimers(estado.timers);
  carregarTabelas();
  renderRoteiro(estado.roteiro);
  els.api.textContent = `http://127.0.0.1:${estado.apiPort}/api/som/1`;
  carregarApps();
  carregarPlaylists();
})();
