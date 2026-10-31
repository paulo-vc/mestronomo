import { app, BrowserWindow, Notification, dialog, globalShortcut, ipcMain, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { Mixer, type MixerSettings, type MonitorMode, type VolumeKey } from './mixer';
import { AppCaptureSource, listAudioApps, type TrackInfo } from './sources';
import { DiscordBot, type BotStatus, type NowPlaying } from './discord';
import { YouTubePlayer, type LoopMode } from './youtube';
import { startApi } from './api';
import { Ambience, type Occasional } from './ambience';
import { Soundboard, type SoundOptions } from './soundboard';
import { listPlaylists, loadPlaylist } from './library';
import { Combat, type CombatState, type NewCombatant } from './combat';
import { Timers, type TimerState } from './timers';
import { listTables, rollTable } from './tables';
import { SceneManager, type Scene, type SceneMusic } from './scenes';
import { PACKAGED, ROOT } from './paths';
import { credentialsInfo, loadCredentials, saveCredentials } from './credentials';
import { createTray } from './tray';
import { DEVELOPER_PORTAL, botIdFromToken, checkToken, inviteUrl } from './botSetup';

if (!PACKAGED) dotenv.config({ path: path.join(ROOT, '.env'), quiet: true });
// Pasta de configuração alternativa (testes, ou mais de um perfil de mesa).
if (process.env.MESTRONOMO_USER_DATA) app.setPath('userData', process.env.MESTRONOMO_USER_DATA);

// Instalado, os arquivos ficam em Documentos\Mestrônomo, fácil de achar e fora da pasta do programa.
const DATA_DIR = PACKAGED ? path.join(app.getPath('documents'), 'Mestrônomo') : ROOT;
const SOUNDS_DIR = path.join(DATA_DIR, 'sons');
const AMBIENT_DIR = path.join(DATA_DIR, 'ambientes');
const MUSIC_DIR = path.join(DATA_DIR, 'musicas');
const TABLES_DIR = path.join(DATA_DIR, 'tabelas');
/** Iniciado junto com o Windows: abre direto na bandeja, sem mostrar a janela. */
const START_HIDDEN = process.argv.includes('--oculto');
const API_PORT = Number(process.env.MESTRONOMO_PORT ?? 7777);

const mixer = new Mixer();
const youtube = new YouTubePlayer(mixer);
const ambience = new Ambience(mixer, AMBIENT_DIR);
let soundboard: Soundboard;
let combat: Combat;
const timers = new Timers();
let scenes: SceneManager;
/** Capturas ativas, por nome do executável. Várias podem tocar juntas. */
const captures = new Map<string, AppCaptureSource>();
let bot: DiscordBot | undefined;
let window: BrowserWindow | undefined;
let tray: ReturnType<typeof createTray> | undefined;
let quitting = false;
const configFile = () => path.join(app.getPath('userData'), 'config.json');

interface SavedConfig {
  mixer?: Partial<MixerSettings>;
  /** Último volume usado para cada app capturado. */
  appVolumes?: Record<string, number>;
  youtube?: { volume: number; repetir: LoopMode };
  /** deviceId da saída de áudio do monitor local. */
  monitorDevice?: string;
  cenas?: Scene[];
  /** Volume, loop e cor de cada som da soundboard, pelo id. */
  sons?: Record<string, SoundOptions>;
  /** Duração do crossfade entre cenas, em ms. */
  fadeMs?: number;
  /** Canal de texto escolhido com /canal (tocando agora e handouts). */
  canalTexto?: string;
  /** Postar e atualizar a mensagem "tocando agora" no canal de texto. */
  tocandoAgora?: boolean;
  /** Combate em andamento (sobrevive a reiniciar o app). */
  combate?: CombatState;
  /** Anunciar "vez de Fulano" no canal de texto a cada turno. */
  anunciarTurnos?: boolean;
}

let config: SavedConfig = {};

function loadConfig(): SavedConfig {
  try {
    return JSON.parse(fs.readFileSync(configFile(), 'utf8'));
  } catch {
    return {};
  }
}

function saveConfig() {
  config.mixer = mixer.settings;
  config.youtube = { volume: youtube.volume, repetir: youtube.loop };
  fs.writeFileSync(configFile(), JSON.stringify(config, null, 2));
}

function send(channel: string, payload: unknown) {
  window?.webContents.send(channel, payload);
}

function listSounds(): string[] {
  return soundboard.list().map((s) => s.id);
}

/** Com `preview`, o som toca só no seu fone (pré-escuta), sem ir para o bot. */
function playSound(ref: string, preview = false) {
  return soundboard.play(ref, preview);
}

function stopEffects() {
  soundboard.stopAll();
}

function capturesState() {
  return [...captures.values()].map((c) => ({ app: c.appName, volume: c.volume }));
}

function startCapture(appName: string) {
  if (captures.has(appName)) return;
  const source = new AppCaptureSource(appName, (error) => {
    if (captures.get(appName) !== source) return;
    captures.delete(appName);
    send('capturas', capturesState());
    if (error) send('erro', `A captura de ${appName} parou: ${error}`);
  });
  source.volume = config.appVolumes?.[appName] ?? 1;
  captures.set(appName, source);
  mixer.add(source);
  send('capturas', capturesState());
}

/** Sem nome, para todas as capturas. */
function stopCapture(appName?: string) {
  for (const [name, source] of captures) {
    if (appName && name !== appName) continue;
    captures.delete(name);
    mixer.remove(source);
  }
  send('capturas', capturesState());
}

function setCaptureVolume(appName: string, value: number) {
  const source = captures.get(appName);
  if (!source) return;
  source.volume = Math.min(1, Math.max(0, value));
  config.appVolumes = { ...config.appVolumes, [appName]: source.volume };
  saveConfig();
}

function setVolume(key: VolumeKey | 'youtube', value: number) {
  if (key === 'youtube') youtube.setVolume(value);
  else mixer.settings[key] = Math.min(1, Math.max(0, value));
  send('mixer', mixer.settings);
  saveConfig();
}

function joinBot() {
  if (!bot) send('erro', 'Configure o bot primeiro (botão ⚙ no topo).');
  return bot?.joinOwner() ?? false;
}

function leaveBot() {
  bot?.leave();
}

function nowPlaying(): NowPlaying {
  const yt = youtube.state();
  const faixa = yt.fila[yt.atual];
  const cenas = scenes.state();
  return {
    musica: faixa && !yt.pausado ? faixa.title : undefined,
    cena: cenas.cenas.find((c) => c.id === cenas.ativa)?.nome,
    ambiente: ambience.state().camadas.map((c) => c.arquivo.replace(/\.[^.]+$/, '')),
  };
}

let lastNowPlaying = '';
/** Chamado a cada mudança de música, cena ou ambiente; só posta quando o resumo muda de fato. */
function refreshNowPlaying() {
  if (!bot || config.tocandoAgora === false || !config.canalTexto) return;
  const info = nowPlaying();
  const assinatura = JSON.stringify(info);
  if (assinatura === lastNowPlaying) return;
  lastNowPlaying = assinatura;
  bot.updateNowPlaying(info);
}

/** Manda texto no canal do /canal, avisando na interface se algo der errado. */
async function postToDiscord(content: string) {
  try {
    if (!bot) throw new Error('Configure o bot primeiro (botão ⚙ no topo).');
    await bot.sendMessage(content);
    return true;
  } catch (err) {
    send('erro', (err as Error).message);
    return false;
  }
}

function rollTableSafe(nome: string) {
  try {
    return rollTable(TABLES_DIR, nome);
  } catch (err) {
    send('erro', (err as Error).message);
    return undefined;
  }
}

async function sendHandout(legenda: string) {
  if (!bot) throw new Error('Configure o bot primeiro (botão ⚙ no topo).');
  const escolha = await dialog.showOpenDialog(window!, {
    title: 'Escolha a imagem para mandar no Discord',
    properties: ['openFile'],
    filters: [{ name: 'Imagens', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }],
  });
  if (escolha.canceled || !escolha.filePaths[0]) return false;
  await bot.sendHandout(escolha.filePaths[0], legenda);
  return true;
}

function state() {
  return {
    bot: bot?.status ?? ({ state: 'desligado', motivo: 'Bot não configurado' } satisfies BotStatus),
    capturas: capturesState(),
    youtube: youtube.state(),
    playlists: listPlaylists(MUSIC_DIR),
    ambiente: ambience.state(),
    cenas: scenes.state(),
    combate: combat.state(),
    anunciarTurnos: config.anunciarTurnos === true,
    timers: timers.state(),
    tabelas: listTables(TABLES_DIR),
    mixer: mixer.settings,
    tocando: { musica: mixer.isPlaying('musica'), efeitos: mixer.isPlaying('efeitos') },
    soundboard: soundboard.state(),
    monitorDevice: config.monitorDevice ?? 'default',
    apiPort: API_PORT,
  };
}

function registerIpc() {
  ipcMain.handle('estado', () => state());
  ipcMain.handle('apps', () => listAudioApps());
  ipcMain.handle('som', (_e, ref: string, preview?: boolean) => playSound(ref, preview));
  ipcMain.handle('som-opcoes', (_e, id: string, changes: Partial<SoundOptions>) => soundboard.setOptions(id, changes));
  ipcMain.handle('monitor', (_e, mode: MonitorMode) => {
    mixer.settings.monitor = mode;
    send('mixer', mixer.settings);
    saveConfig();
  });
  ipcMain.handle('monitor-saida', (_e, deviceId: string) => {
    config.monitorDevice = deviceId;
    saveConfig();
  });
  ipcMain.handle('parar-efeitos', () => stopEffects());
  ipcMain.handle('capturar', (_e, appName: string) => startCapture(appName));
  ipcMain.handle('parar-captura', (_e, appName?: string) => stopCapture(appName));
  ipcMain.handle('volume-captura', (_e, appName: string, value: number) => setCaptureVolume(appName, value));
  ipcMain.handle('volume', (_e, key: VolumeKey | 'youtube', value: number) => setVolume(key, value));
  ipcMain.handle('abrir-sons', () => shell.openPath(SOUNDS_DIR));
  ipcMain.handle('bot-entrar', () => joinBot());
  ipcMain.handle('bot-sair', () => leaveBot());
  ipcMain.handle('yt-adicionar', (_e, url: string) => youtube.add(url));
  ipcMain.handle('yt-buscar', (_e, query: string) => youtube.search(query));
  ipcMain.handle('yt-adicionar-faixa', (_e, track: TrackInfo) => youtube.addTracks([track]));
  ipcMain.handle('playlists', () => listPlaylists(MUSIC_DIR));
  ipcMain.handle('playlist-carregar', async (_e, nome: string) => youtube.addTracks(await loadPlaylist(MUSIC_DIR, nome)));
  ipcMain.handle('abrir-musicas', () => shell.openPath(MUSIC_DIR));
  ipcMain.handle('yt-tocar', (_e, index: number) => youtube.play(index));
  ipcMain.handle('yt-pausar', () => youtube.togglePause());
  ipcMain.handle('yt-proxima', () => youtube.next());
  ipcMain.handle('yt-anterior', () => youtube.previous());
  ipcMain.handle('yt-parar', () => youtube.stop());
  ipcMain.handle('yt-remover', (_e, index: number) => youtube.remove(index));
  ipcMain.handle('yt-limpar', () => youtube.clear());
  ipcMain.handle('yt-repetir', (_e, mode: LoopMode) => {
    youtube.setLoop(mode);
    saveConfig();
  });
  ipcMain.handle('amb-alternar', (_e, arquivo: string) => ambience.toggle(arquivo));
  ipcMain.handle('amb-volume', (_e, arquivo: string, volume: number) => ambience.setLayerVolume(arquivo, volume));
  ipcMain.handle('amb-ocasional', (_e, config: Occasional) => ambience.addOccasional(config));
  ipcMain.handle('amb-ocasional-remover', (_e, id: string) => ambience.removeOccasional(id));
  ipcMain.handle('amb-parar', () => ambience.stopAll(1500));
  ipcMain.handle('abrir-ambientes', () => shell.openPath(AMBIENT_DIR));
  ipcMain.handle('cena-salvar', (_e, nome: string, musica: SceneMusic['modo']) => scenes.saveCurrent(nome, musica));
  ipcMain.handle('cena-ativar', (_e, ref: string) => scenes.activate(ref));
  ipcMain.handle('cena-remover', (_e, id: string) => scenes.remove(id));
  ipcMain.handle('cena-fade', (_e, ms: number) => scenes.setFade(ms));
  ipcMain.handle('config-info', () => ({
    ...credentialsInfo(),
    autoStart: isAutoStart(),
    tocandoAgora: config.tocandoAgora !== false,
    canalTexto: Boolean(config.canalTexto),
  }));
  ipcMain.handle('config-salvar', async (_e, token: string, ownerId: string, autoStart: boolean, tocandoAgora: boolean) => {
    if (!credentialsInfo().fromEnv) saveCredentials(token, ownerId);
    setAutoStart(autoStart);
    config.tocandoAgora = tocandoAgora;
    saveConfig();
    await restartBot();
  });
  ipcMain.handle('combate-add', (_e, novo: NewCombatant) => combat.add(novo));
  ipcMain.handle('combate-remover', (_e, id: string) => combat.remove(id));
  ipcMain.handle('combate-hp', (_e, id: string, entrada: string) => combat.applyHp(id, entrada));
  ipcMain.handle('combate-iniciativa', (_e, id: string, valor: number) => combat.setInitiative(id, valor));
  ipcMain.handle('combate-cena', (_e, id: string) => combat.setCombatScene(id));
  ipcMain.handle('combate-iniciar', () => combat.start());
  ipcMain.handle('combate-proximo', () => combat.next());
  ipcMain.handle('combate-anterior', () => combat.previous());
  ipcMain.handle('combate-encerrar', () => combat.end());
  ipcMain.handle('combate-limpar', () => combat.clearNpcs());
  ipcMain.handle('combate-anunciar', (_e, sim: boolean) => {
    config.anunciarTurnos = sim;
    saveConfig();
  });
  ipcMain.handle('timer-add', (_e, nome: string, segundos: number, som?: string) => timers.add(nome, segundos, som));
  ipcMain.handle('timer-pausar', (_e, id: string) => timers.togglePause(id));
  ipcMain.handle('timer-remover', (_e, id: string) => timers.remove(id));
  ipcMain.handle('tabelas', () => listTables(TABLES_DIR));
  ipcMain.handle('tabela-rolar', (_e, nome: string) => rollTableSafe(nome));
  ipcMain.handle('discord-texto', (_e, texto: string) => postToDiscord(texto));
  ipcMain.handle('abrir-tabelas', () => shell.openPath(TABLES_DIR));
  ipcMain.handle('bot-verificar', (_e, token: string) => checkToken(token));
  ipcMain.handle('bot-portal', () => shell.openExternal(DEVELOPER_PORTAL));
  ipcMain.handle('bot-convidar', (_e, token?: string) => openInvite(token));
  ipcMain.handle('handout', async (_e, legenda: string) => {
    try {
      return await sendHandout(legenda);
    } catch (err) {
      send('erro', (err as Error).message);
      return false;
    }
  });
}

/** Abre o convite do bot: do token digitado na tela, ou do bot já configurado. */
function openInvite(token?: string) {
  const id = botIdFromToken(token || loadCredentials()?.token || '');
  if (!id) {
    send('erro', 'Configure o token do bot primeiro (botão ⚙).');
    return false;
  }
  shell.openExternal(inviteUrl(id));
  return true;
}

function isAutoStart() {
  return app.getLoginItemSettings().openAtLogin;
}

function setAutoStart(enabled: boolean) {
  // Em desenvolvimento o executável é o electron.exe, que precisa do caminho do projeto.
  const args = PACKAGED ? ['--oculto'] : [ROOT, '--oculto'];
  app.setLoginItemSettings({ openAtLogin: enabled, path: process.execPath, args });
  tray?.rebuild();
}

function showWindow() {
  if (!window) return;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

function createWindow() {
  window = new BrowserWindow({
    width: 1100,
    height: 820,
    minWidth: 560,
    minHeight: 480,
    title: 'Mestrônomo',
    show: !START_HIDDEN,
    backgroundColor: '#15121c',
    icon: path.join(ROOT, 'assets', 'icon.ico'),
    autoHideMenuBar: true,
    // Sem exigir clique antes do áudio: o monitor local precisa tocar assim que o app abre.
    webPreferences: { preload: path.join(__dirname, 'preload.js'), autoplayPolicy: 'no-user-gesture-required' },
  });
  window.loadFile(path.join(ROOT, 'src', 'renderer', 'index.html'));

  // Fechar a janela só esconde: o bot e os atalhos continuam funcionando pela bandeja.
  let avisou = false;
  window.on('close', (event) => {
    if (quitting) return;
    event.preventDefault();
    window?.hide();
    if (!avisou && Notification.isSupported()) {
      avisou = true;
      new Notification({ title: 'Mestrônomo continua aberto', body: 'Ele fica na bandeja do Windows. Para sair, use "Sair" no ícone.' }).show();
    }
  });
}

/** Ctrl+Alt+1..9 tocam os primeiros sons; Ctrl+Alt+0 para os efeitos. Funcionam com o app em segundo plano. */
function registerShortcuts() {
  for (let i = 1; i <= 9; i++) {
    globalShortcut.register(`Control+Alt+${i}`, () => {
      const sound = listSounds()[i - 1];
      if (sound) playSound(sound);
    });
  }
  globalShortcut.register('Control+Alt+0', stopEffects);
}

function startBot() {
  const credentials = loadCredentials();
  if (!credentials) return send('bot', state().bot);
  bot = new DiscordBot(mixer, credentials.token, credentials.ownerId);
  bot.textChannelId = config.canalTexto;
  bot.on('canal', (id: string) => {
    config.canalTexto = id;
    saveConfig();
    lastNowPlaying = '';
    refreshNowPlaying();
  });
  bot.on('status', (status) => {
    send('bot', status);
    tray?.rebuild();
  });
  bot.on('erro', (msg) => send('erro', msg));
  bot.start();
}

async function restartBot() {
  const old = bot;
  bot = undefined;
  await old?.destroy();
  startBot();
}

// Uma instância só: abrir o atalho de novo traz a janela que já está rodando.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showWindow);
}

/** Instalado, a pasta de tabelas começa vazia em Documentos: copia os exemplos na primeira vez. */
function seedExampleTables() {
  if (!PACKAGED || fs.existsSync(TABLES_DIR)) return;
  fs.mkdirSync(TABLES_DIR, { recursive: true });
  const examples = path.join(ROOT, 'tabelas');
  for (const file of fs.readdirSync(examples)) fs.copyFileSync(path.join(examples, file), path.join(TABLES_DIR, file));
}

app.whenReady().then(() => {
  if (!app.hasSingleInstanceLock()) return;
  seedExampleTables();
  config = loadConfig();
  Object.assign(mixer.settings, config.mixer);
  if (config.youtube) {
    youtube.volume = config.youtube.volume;
    youtube.loop = config.youtube.repetir;
  }
  mixer.on('change', () => send('tocando', state().tocando));
  // ~50 mensagens por segundo de 3,8 KB: o IPC do Electron dá conta tranquilo.
  mixer.on('monitor', (pcm: Buffer) => window?.webContents.send('pcm', pcm));
  youtube.on('change', (s) => {
    send('youtube', s);
    refreshNowPlaying();
  });
  youtube.on('erro', (msg) => send('erro', msg));
  ambience.on('change', (s) => {
    send('ambiente', s);
    refreshNowPlaying();
  });
  soundboard = new Soundboard(mixer, SOUNDS_DIR, config.sons);
  soundboard.on('change', (s) => send('soundboard', s));
  soundboard.on('options', (sons: Record<string, SoundOptions>) => {
    config.sons = sons;
    saveConfig();
  });
  scenes = new SceneManager(ambience, youtube, config.cenas, config.fadeMs);
  scenes.on('change', (s) => {
    send('cenas', s);
    refreshNowPlaying();
  });

  // Combate: ao começar ativa a cena de combate; ao encerrar volta para a cena de antes.
  combat = new Combat(config.combate);
  let cenaAntesDoCombate: string | undefined;
  combat.on('change', (s: CombatState) => {
    config.combate = s;
    saveConfig();
    send('combate', s);
  });
  combat.on('inicio', (cena?: string) => {
    cenaAntesDoCombate = scenes.state().ativa;
    if (cena) scenes.activate(cena);
  });
  combat.on('fim', () => {
    if (combat.state().cenaCombate && cenaAntesDoCombate) scenes.activate(cenaAntesDoCombate);
    cenaAntesDoCombate = undefined;
  });
  combat.on('turno', (c: { nome: string; jogador: boolean }, rodada: number) => {
    if (config.anunciarTurnos) postToDiscord(`⚔️ **Rodada ${rodada}** — vez de **${c.nome}**`);
  });

  timers.on('change', (s: TimerState[]) => send('timers', s));
  timers.on('fim', (t: TimerState) => {
    if (t.som) playSound(t.som);
    send('timer-fim', t);
    if (Notification.isSupported()) new Notification({ title: `⏰ ${t.nome}`, body: 'O tempo acabou.' }).show();
  });
  scenes.on('save', (cenas: Scene[], fadeMs: number) => {
    config.cenas = cenas;
    config.fadeMs = fadeMs;
    saveConfig();
  });
  mixer.start();

  registerIpc();
  registerShortcuts();
  startApi(API_PORT, {
    state,
    listSounds,
    listApps: listAudioApps,
    playSound,
    stopEffects,
    startCapture,
    stopCapture,
    setVolume,
    joinBot,
    leaveBot,
    youtube,
    ambience,
    scenes,
    loadPlaylist: async (nome: string) => youtube.addTracks(await loadPlaylist(MUSIC_DIR, nome)),
    combat,
    timers,
    rollTable: (nome: string) => rollTable(TABLES_DIR, nome),
  });
  startBot();
  createWindow();
  tray = createTray({
    show: showWindow,
    quit: () => app.quit(),
    isBotInCall: () => bot?.status.state === 'no-canal',
    toggleBot: () => (bot?.status.state === 'no-canal' ? leaveBot() : joinBot()),
    stopEffects,
    isAutoStart,
    setAutoStart,
    invite: () => openInvite(),
  });
});

app.on('before-quit', async (event) => {
  if (quitting) return;
  quitting = true;
  event.preventDefault();
  globalShortcut.unregisterAll();
  mixer.stop();
  await bot?.destroy();
  app.quit();
});
