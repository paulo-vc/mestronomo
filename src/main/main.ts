import { app, BrowserWindow, globalShortcut, ipcMain, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { Mixer, type MixerSettings } from './mixer';
import { AppCaptureSource, FileSource, listAudioApps } from './sources';
import { DiscordBot, type BotStatus } from './discord';
import { startApi } from './api';

const ROOT = path.join(__dirname, '..', '..');
dotenv.config({ path: path.join(ROOT, '.env'), quiet: true });

const SOUNDS_DIR = path.join(ROOT, 'sons');
const AUDIO_EXT = new Set(['.mp3', '.ogg', '.wav', '.flac', '.m4a', '.opus', '.webm']);
const API_PORT = Number(process.env.MESTRONOMO_PORT ?? 7777);

const mixer = new Mixer();
let bot: DiscordBot | undefined;
let capture: AppCaptureSource | undefined;
let window: BrowserWindow | undefined;
const configFile = () => path.join(app.getPath('userData'), 'config.json');

interface SavedConfig {
  mixer?: Partial<MixerSettings>;
  app?: string;
}

function loadConfig(): SavedConfig {
  try {
    return JSON.parse(fs.readFileSync(configFile(), 'utf8'));
  } catch {
    return {};
  }
}

function saveConfig() {
  const config: SavedConfig = { mixer: mixer.settings, app: capture?.appName ?? loadConfig().app };
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

function startCapture(appName: string) {
  stopCapture();
  const source = new AppCaptureSource(appName, (error) => {
    if (capture !== source) return;
    capture = undefined;
    send('captura', { app: undefined, erro: error });
  });
  capture = source;
  mixer.add(source);
  send('captura', { app: appName });
  saveConfig();
}

function stopCapture() {
  if (!capture) return;
  const old = capture;
  capture = undefined;
  mixer.remove(old);
  send('captura', { app: undefined });
}

function setVolume(key: keyof MixerSettings, value: number) {
  mixer.settings[key] = Math.min(1, Math.max(0, value));
  send('mixer', mixer.settings);
  saveConfig();
}

function state() {
  return {
    bot: bot?.status ?? ({ state: 'desligado', motivo: 'Configure o arquivo .env' } satisfies BotStatus),
    captura: capture?.appName,
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
  ipcMain.handle('captura', (_e, appName: string | null) => (appName ? startCapture(appName) : stopCapture()));
  ipcMain.handle('volume', (_e, key: keyof MixerSettings, value: number) => setVolume(key, value));
  ipcMain.handle('abrir-sons', () => shell.openPath(SOUNDS_DIR));
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
  const saved = loadConfig();
  Object.assign(mixer.settings, saved.mixer);
  mixer.on('change', () => send('tocando', state().tocando));
  mixer.start();

  registerIpc();
  registerShortcuts();
  startApi(API_PORT, { state, listSounds, playSound, stopEffects, startCapture, stopCapture, setVolume });
  startBot();

  window = new BrowserWindow({
    width: 960,
    height: 720,
    minWidth: 560,
    minHeight: 480,
    title: 'Mestrônomo',
    backgroundColor: '#15121c',
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

