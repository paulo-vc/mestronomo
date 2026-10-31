import { UlanziApi } from './ulanzi-api/index.js';
import { api, encode } from './mestronomo.js';
import { COLORS } from './glyphs.js';
import { writeKeyImage, clearKeyImages, clearAllKeyImages } from './keyImage.js';

const PLUGIN_UUID = 'com.ulanzi.ulanzistudio.mestronomo';
const POLL_MS = 1000;

const $UD = new UlanziApi();

// context -> { kind, settings, active, lastRender }
const ACTIONS = {};
let estado = null;
let online = false;

const MESSAGES = {
  en: { noCombat: 'No combat', offline: 'Open Mestrônomo', noScene: 'Pick a scene', noSound: 'Pick a sound', noApp: 'Pick an app', inCall: 'IN CALL', outCall: 'CALL BOT', nothing: 'Nothing playing', preview: 'PREVIEW' },
  pt: { noCombat: 'Sem combate', offline: 'Abra o Mestrônomo', noScene: 'Escolha uma cena', noSound: 'Escolha um som', noApp: 'Escolha um app', inCall: 'NA CALL', outCall: 'CHAMAR BOT', nothing: 'Nada tocando', preview: 'PRÉVIA' },
};

function t(key) {
  const lang = String($UD.language || 'en').startsWith('pt') ? 'pt' : 'en';
  return MESSAGES[lang][key];
}

const TARGETS = { musica: 'Música', efeitos: 'Efeitos', master: 'Geral', youtube: 'YouTube', monitorVolume: 'Fone' };

/** Nome bonito de um som: sem categoria ("Combate/espada" → "espada"), número na frente nem extensão. */
const soundName = (id) => String(id || '').split('/').pop().replace(/\.[^.]+$/, '').replace(/^\d+[\s._-]*/, '');

function normalize(kind, param = {}) {
  switch (kind) {
    case 'som':
      return { som: param.som || '', previa: param.previa === true || param.previa === 'on' };
    case 'volume':
      return {
        alvo: TARGETS[param.alvo] ? param.alvo : 'musica',
        direcao: param.direcao === 'menos' ? 'menos' : 'mais',
        passo: Math.min(50, Math.max(1, Number(param.passo) || 10)),
      };
    case 'captura':
      return { app: param.app || '' };
    case 'cena':
      return { cena: param.cena || '' };
    default:
      return {};
  }
}

function upsert(jsn) {
  const kind = String(jsn.uuid || '').split('.').pop();
  const action = ACTIONS[jsn.context] || { kind, active: true, lastRender: null };
  if (jsn.param && Object.keys(jsn.param).length) action.settings = normalize(kind, jsn.param);
  else if (!action.settings) action.settings = normalize(kind);
  action.lastRender = null;
  ACTIONS[jsn.context] = action;
  return action;
}

function volumeOf(alvo) {
  if (!estado) return undefined;
  return alvo === 'youtube' ? estado.youtube.volume : estado.mixer[alvo];
}

/** O que a tecla mostra, a partir do último estado do Mestrônomo. */
function keyFace(action) {
  if (!online) return { glyph: 'aviso', text: t('offline'), color: COLORS.muted };
  const { kind, settings } = action;
  switch (kind) {
    case 'som':
      if (!settings.som) return { glyph: 'som', text: t('noSound'), color: COLORS.muted };
      return { glyph: settings.previa ? 'previa' : 'som', text: soundName(settings.som), badge: settings.previa ? t('preview') : undefined };
    case 'youtube': {
      const yt = estado.youtube;
      const faixa = yt.fila[yt.atual];
      const tocando = faixa && !yt.pausado;
      return { glyph: tocando ? 'pause' : 'play', text: faixa ? faixa.title : t('nothing'), color: faixa ? COLORS.gold : COLORS.muted };
    }
    case 'proxima': {
      const proxima = estado.youtube.fila[estado.youtube.atual + 1];
      return { glyph: 'proxima', text: proxima?.title, color: proxima ? COLORS.gold : COLORS.muted };
    }
    case 'pararefeitos':
      return { glyph: 'pararEfeitos', color: estado.tocando.efeitos ? COLORS.gold : COLORS.muted };
    case 'bot': {
      const naCall = estado.bot.state === 'no-canal';
      return {
        glyph: 'bot',
        text: naCall ? estado.bot.canal : t('outCall'),
        color: naCall ? COLORS.gold : COLORS.muted,
        background: naCall ? COLORS.backgroundOn : COLORS.backgroundOff,
        badge: naCall ? 'ON' : undefined,
      };
    }
    case 'volume': {
      const valor = volumeOf(settings.alvo);
      return {
        glyph: settings.direcao === 'menos' ? 'volumeMenos' : 'volumeMais',
        text: TARGETS[settings.alvo],
        badge: valor === undefined ? undefined : `${Math.round(valor * 100)}%`,
      };
    }
    case 'turno': {
      const combate = estado.combate;
      const atual = combate.ativo ? combate.combatentes[combate.turno] : undefined;
      if (!atual) return { glyph: 'turno', text: t('noCombat'), color: COLORS.muted };
      return { glyph: 'turno', text: atual.nome, badge: `R${combate.rodada}`, background: COLORS.backgroundOn };
    }
    case 'cena': {
      const cena = estado.cenas.cenas.find((c) => c.id === settings.cena);
      if (!cena) return { glyph: 'cena', text: t('noScene'), color: COLORS.muted };
      const ativa = estado.cenas.ativa === cena.id;
      return {
        glyph: 'cena',
        text: cena.nome,
        color: ativa ? COLORS.gold : COLORS.muted,
        background: ativa ? COLORS.backgroundOn : COLORS.background,
      };
    }
    case 'captura': {
      if (!settings.app) return { glyph: 'captura', text: t('noApp'), color: COLORS.muted };
      const ativa = estado.capturas.some((c) => c.app === settings.app);
      return {
        glyph: 'captura',
        text: settings.app.replace(/\.exe$/i, ''),
        color: ativa ? COLORS.gold : COLORS.muted,
        background: ativa ? COLORS.backgroundOn : COLORS.backgroundOff,
        badge: ativa ? 'ON' : undefined,
      };
    }
    default:
      return { glyph: 'aviso', text: kind };
  }
}

function render(context) {
  const action = ACTIONS[context];
  if (!action || !action.active) return;
  const face = keyFace(action);
  const signature = JSON.stringify(face);
  if (signature === action.lastRender) return;
  action.lastRender = signature;
  try {
    $UD.setPathIcon(context, writeKeyImage(context, face), '');
  } catch (err) {
    $UD.logMessage(`render failed: ${err.message}`, 'error');
  }
}

async function refresh() {
  try {
    estado = await api('estado');
    online = true;
  } catch {
    online = false;
  }
  Object.keys(ACTIONS).forEach(render);
}

// Só consulta o Mestrônomo enquanto há teclas do plugin na tela.
setInterval(() => {
  if (Object.values(ACTIONS).some((a) => a.active)) refresh();
}, POLL_MS);

async function run(context, action) {
  const { kind, settings } = action;
  switch (kind) {
    case 'som':
      if (!settings.som) throw new Error('nenhum som escolhido');
      return api(`${settings.previa ? 'previa' : 'som'}/${encode(settings.som)}`);
    case 'youtube':
      return api('youtube/pausar');
    case 'proxima':
      return api('youtube/proxima');
    case 'pararefeitos':
      return api('efeitos/parar');
    case 'bot':
      return api(estado?.bot.state === 'no-canal' ? 'bot/sair' : 'bot/entrar');
    case 'volume': {
      const atual = volumeOf(settings.alvo) ?? 0;
      const delta = (settings.direcao === 'menos' ? -settings.passo : settings.passo) / 100;
      const novo = Math.round(Math.min(1, Math.max(0, atual + delta)) * 100);
      return api(`volume/${settings.alvo}/${novo}`);
    }
    case 'turno': {
      const combate = estado.combate;
      const atual = combate.ativo ? combate.combatentes[combate.turno] : undefined;
      if (!atual) return { glyph: 'turno', text: t('noCombat'), color: COLORS.muted };
      return { glyph: 'turno', text: atual.nome, badge: `R${combate.rodada}`, background: COLORS.backgroundOn };
    }
    case 'cena': {
      const cena = estado.cenas.cenas.find((c) => c.id === settings.cena);
      if (!cena) return { glyph: 'cena', text: t('noScene'), color: COLORS.muted };
      const ativa = estado.cenas.ativa === cena.id;
      return {
        glyph: 'cena',
        text: cena.nome,
        color: ativa ? COLORS.gold : COLORS.muted,
        background: ativa ? COLORS.backgroundOn : COLORS.background,
      };
    }
    case 'turno':
      return api(estado?.combate.ativo ? 'combate/proximo' : 'combate/iniciar');
    case 'cena':
      if (!settings.cena) throw new Error('nenhuma cena escolhida');
      return api(`cena/${encode(settings.cena)}`);
    case 'captura': {
      if (!settings.app) throw new Error('nenhum app escolhido');
      const ativa = estado?.capturas.some((c) => c.app === settings.app);
      return api(`musica/${ativa ? 'parar' : 'capturar'}/${encode(settings.app)}`);
    }
  }
}

clearAllKeyImages();
$UD.connect(PLUGIN_UUID);

$UD.onAdd((jsn) => {
  upsert(jsn);
  refresh();
});

$UD.onParamFromApp((jsn) => {
  upsert(jsn);
  refresh();
});

$UD.onParamFromPlugin((jsn) => {
  upsert(jsn);
  refresh();
});

$UD.onSetActive((jsn) => {
  const action = ACTIONS[jsn.context];
  if (!action) return;
  action.active = jsn.active;
  if (jsn.active) {
    action.lastRender = null;
    render(jsn.context);
  }
});

$UD.onClear((jsn) => {
  (jsn.param || []).forEach((item) => {
    delete ACTIONS[item.context];
    clearKeyImages(item.context);
  });
});

$UD.onRun(async (jsn) => {
  const action = ACTIONS[jsn.context] || upsert(jsn);
  try {
    await run(jsn.context, action);
  } catch (err) {
    $UD.showAlert(jsn.context);
    $UD.logMessage(`action failed: ${err.message}`, 'error');
  }
  refresh();
});

// O property inspector pede a lista de sons ou de apps para preencher o select.
$UD.onSendToPlugin(async (jsn) => {
  const { cmd } = jsn.payload || {};
  const rotas = { getSons: 'sons', getApps: 'apps', getCenas: 'cenas' };
  if (!rotas[cmd]) return;
  try {
    const resposta = await api(rotas[cmd]);
    const lista = cmd === 'getCenas' ? resposta.cenas : resposta;
    $UD.sendToPropertyInspector({ cmd, lista }, jsn.context);
  } catch (err) {
    $UD.sendToPropertyInspector({ cmd, lista: [], erro: t('offline') }, jsn.context);
  }
});
