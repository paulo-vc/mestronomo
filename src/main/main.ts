import { app, BrowserWindow, Notification, globalShortcut, ipcMain, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { Mixer, type MixerSettings, type MonitorMode, type VolumeKey } from './mixer';
import { AppCaptureSource, FileSource, listAudioApps } from './sources';
import { DiscordBot, type BotStatus } from './discord';
import { YouTubePlayer, type LoopMode } from './youtube';
import { startApi } from './api';
import { AUDIO_EXT, Ambience, type Occasional } from './ambience';
import { SceneManager, type Scene, type SceneMusic } from './scenes';
import { PACKAGED, ROOT } from './paths';
import { credentialsInfo, loadCredentials, saveCredentials } from './credentials';
import { createTray } from './tray';

if (!PACKAGED) dotenv.config({ path: path.join(ROOT, '.env'), quiet: true });

// Instalado, os arquivos ficam em Documentos\Mestrônomo, fácil de achar e fora da pasta do programa.
const DATA_DIR = PACKAGED ? path.join(app.getPath('documents'), 'Mestrônomo') : ROOT;
const SOUNDS_DIR = path.join(DATA_DIR, 'sons');
const AMBIENT_DIR = path.join(DATA_DIR, 'ambientes');
/** Iniciado junto com o Windows: abre direto na bandeja, sem mostrar a janela. */
const START_HIDDEN = process.argv.includes('--oculto');
const API_PORT = Number(process.env.MESTRONOMO_PORT ?? 7777);

const mixer = new Mixer();
const youtube = new YouTubePlayer(mixer);
const ambience = new Ambience(mixer, AMBIENT_DIR);
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
  /** Duração do crossfade entre cenas, em ms. */
  fadeMs?: number;
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
  fs.mkdirSync(SOUNDS_DIR, { recursive: true });
  return fs
    .readdirSync(SOUNDS_DIR)
    .filter((f) => AUDIO_EXT.has(path.extname(f).toLowerCase()))
    .sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true }));
}

/** Com `preview`, o som toca só no seu fone (pré-escuta), sem ir para o bot. */
function playSound(name: string, preview = false) {
  const file = path.join(SOUNDS_DIR, path.basename(name));
  if (!fs.existsSync(file)) return false;
  mixer.add(new FileSource(file, 'efeitos', preview));
  return true;
}

function stopEffects() {
  mixer.stopBus('efeitos');
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

function state() {
  return {
    bot: bot?.status ?? ({ state: 'desligado', motivo: 'Bot não configurado' } satisfies BotStatus),
    capturas: capturesState(),
    youtube: youtube.state(),
    ambiente: ambience.state(),
    cenas: scenes.state(),
    mixer: mixer.settings,
    tocando: { musica: mixer.isPlaying('musica'), efeitos: mixer.isPlaying('efeitos') },
    sons: listSounds(),
    monitorDevice: config.monitorDevice ?? 'default',
    apiPort: API_PORT,
  };
}

function registerIpc() {
  ipcMain.handle('estado', () => state());
  ipcMain.handle('apps', () => listAudioApps());
  ipcMain.handle('som', (_e, name: string, preview?: boolean) => playSound(name, preview));
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
  ipcMain.handle('config-info', () => ({ ...credentialsInfo(), autoStart: isAutoStart() }));
  ipcMain.handle('config-salvar', async (_e, token: string, ownerId: string, autoStart: boolean) => {
    if (!credentialsInfo().fromEnv) saveCredentials(token, ownerId);
    setAutoStart(autoStart);
    await restartBot();
  });
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

app.whenReady().then(() => {
  if (!app.hasSingleInstanceLock()) return;
  config = loadConfig();
  Object.assign(mixer.settings, config.mixer);
  if (config.youtube) {
    youtube.volume = config.youtube.volume;
    youtube.loop = config.youtube.repetir;
  }
  mixer.on('change', () => send('tocando', state().tocando));
  // ~50 mensagens por segundo de 3,8 KB: o IPC do Electron dá conta tranquilo.
  mixer.on('monitor', (pcm: Buffer) => window?.webContents.send('pcm', pcm));
  youtube.on('change', (s) => send('youtube', s));
  youtube.on('erro', (msg) => send('erro', msg));
  ambience.on('change', (s) => send('ambiente', s));
  scenes = new SceneManager(ambience, youtube, config.cenas, config.fadeMs);
  scenes.on('change', (s) => send('cenas', s));
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
