import { app, BrowserWindow, globalShortcut, ipcMain, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { Mixer, type MixerSettings } from './mixer';
import { AppCaptureSource, FileSource, listAudioApps } from './sources';
import { DiscordBot, type BotStatus } from './discord';
import { YouTubePlayer, type LoopMode } from './youtube';
import { startApi } from './api';

const ROOT = path.join(__dirname, '..', '..');
dotenv.config({ path: path.join(ROOT, '.env'), quiet: true });

const SOUNDS_DIR = path.join(ROOT, 'sons');
const AUDIO_EXT = new Set(['.mp3', '.ogg', '.wav', '.flac', '.m4a', '.opus', '.webm']);
const API_PORT = Number(process.env.MESTRONOMO_PORT ?? 7777);

const mixer = new Mixer();
const youtube = new YouTubePlayer(mixer);
/** Capturas ativas, por nome do executável. Várias podem tocar juntas. */
const captures = new Map<string, AppCaptureSource>();
let bot: DiscordBot | undefined;
let window: BrowserWindow | undefined;
const configFile = () => path.join(app.getPath('userData'), 'config.json');

interface SavedConfig {
  mixer?: Partial<MixerSettings>;
  /** Último volume usado para cada app capturado. */
  appVolumes?: Record<string, number>;
  youtube?: { volume: number; repetir: LoopMode };
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

function playSound(name: string) {
  const file = path.join(SOUNDS_DIR, path.basename(name));
  if (!fs.existsSync(file)) return false;
  mixer.add(new FileSource(file, 'efeitos'));
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

function setVolume(key: keyof MixerSettings | 'youtube', value: number) {
  if (key === 'youtube') youtube.setVolume(value);
  else mixer.settings[key] = Math.min(1, Math.max(0, value));
  send('mixer', mixer.settings);
  saveConfig();
}

function joinBot() {
  if (!bot) send('erro', 'Configure DISCORD_TOKEN e DISCORD_OWNER_ID no arquivo .env');
  return bot?.joinOwner() ?? false;
}

function leaveBot() {
  bot?.leave();
}

function state() {
  return {
    bot: bot?.status ?? ({ state: 'desligado', motivo: 'Configure o arquivo .env' } satisfies BotStatus),
    capturas: capturesState(),
    youtube: youtube.state(),
    mixer: mixer.settings,
    tocando: { musica: mixer.isPlaying('musica'), efeitos: mixer.isPlaying('efeitos') },
    sons: listSounds(),
    apiPort: API_PORT,
  };
}

function registerIpc() {
  ipcMain.handle('estado', () => state());
  ipcMain.handle('apps', () => listAudioApps());
  ipcMain.handle('som', (_e, name: string) => playSound(name));
  ipcMain.handle('parar-efeitos', () => stopEffects());
  ipcMain.handle('capturar', (_e, appName: string) => startCapture(appName));
  ipcMain.handle('parar-captura', (_e, appName?: string) => stopCapture(appName));
  ipcMain.handle('volume-captura', (_e, appName: string, value: number) => setCaptureVolume(appName, value));
  ipcMain.handle('volume', (_e, key: keyof MixerSettings | 'youtube', value: number) => setVolume(key, value));
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
  const { DISCORD_TOKEN, DISCORD_OWNER_ID } = process.env;
  if (!DISCORD_TOKEN || !DISCORD_OWNER_ID) return;
  bot = new DiscordBot(mixer, DISCORD_TOKEN, DISCORD_OWNER_ID);
  bot.on('status', (status) => send('bot', status));
  bot.on('erro', (msg) => send('erro', msg));
  bot.start();
}

app.whenReady().then(() => {
  config = loadConfig();
  Object.assign(mixer.settings, config.mixer);
  if (config.youtube) {
    youtube.volume = config.youtube.volume;
    youtube.loop = config.youtube.repetir;
  }
  mixer.on('change', () => send('tocando', state().tocando));
  youtube.on('change', (s) => send('youtube', s));
  youtube.on('erro', (msg) => send('erro', msg));
  mixer.start();

  registerIpc();
  registerShortcuts();
  startApi(API_PORT, {
    state,
    listSounds,
    playSound,
    stopEffects,
    startCapture,
    stopCapture,
    setVolume,
    joinBot,
    leaveBot,
    youtube,
  });
  startBot();

  window = new BrowserWindow({
    width: 1100,
    height: 820,
    minWidth: 560,
    minHeight: 480,
    title: 'Mestrônomo',
    backgroundColor: '#15121c',
    icon: path.join(ROOT, 'assets', 'icon.ico'),
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  window.loadFile(path.join(ROOT, 'src', 'renderer', 'index.html'));
});

app.on('window-all-closed', async () => {
  globalShortcut.unregisterAll();
  mixer.stop();
  await bot?.destroy();
  app.quit();
});
