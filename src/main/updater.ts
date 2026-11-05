import { app } from 'electron';
import { autoUpdater } from 'electron-updater';
import { EventEmitter } from 'node:events';
import { isNewer } from './version';

// Atualização pelas releases do GitHub.
// - Instalado (NSIS): baixa em segundo plano e instala ao reiniciar (ou ao fechar o app).
// - Portátil: não há instalador para trocar; só avisa que há versão nova e onde baixar.

const REPO = 'paulo-vc/mestronomo';
const RELEASES = `https://github.com/${REPO}/releases/latest`;
const INTERVALO_MS = 6 * 60 * 60 * 1000;

export type UpdateState =
  | { estado: 'nenhuma' }
  | { estado: 'baixando'; versao: string; progresso: number }
  | { estado: 'pronta'; versao: string }
  | { estado: 'disponivel'; versao: string; url: string };

export class Updater extends EventEmitter {
  state: UpdateState = { estado: 'nenhuma' };

  constructor(private portable: boolean) {
    super();
  }

  start() {
    if (!app.isPackaged) return;
    if (!this.portable) {
      autoUpdater.autoDownload = true;
      autoUpdater.autoInstallOnAppQuit = true;
      autoUpdater.on('download-progress', (p) => this.set({ estado: 'baixando', versao: this.pendingVersion, progresso: Math.round(p.percent) }));
      autoUpdater.on('update-available', (info) => (this.pendingVersion = info.version));
      autoUpdater.on('update-downloaded', (info) => this.set({ estado: 'pronta', versao: info.version }));
      // Sem internet ou release sem latest.yml: tenta de novo no próximo intervalo, sem incomodar.
      autoUpdater.on('error', (err) => console.warn('[atualização]', err.message));
    }
    this.check();
    setInterval(() => this.check(), INTERVALO_MS).unref();
  }

  /** Reinicia instalando a atualização já baixada. */
  installNow() {
    if (this.state.estado === 'pronta') autoUpdater.quitAndInstall(false, true);
  }

  private pendingVersion = '';

  private async check() {
    if (!this.portable) {
      autoUpdater.checkForUpdates().catch((err) => console.warn('[atualização]', err.message));
      return;
    }
    try {
      const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } });
      if (!res.ok) return;
      const versao = String(((await res.json()) as { tag_name: string }).tag_name).replace(/^v/, '');
      if (isNewer(versao, app.getVersion())) this.set({ estado: 'disponivel', versao, url: RELEASES });
    } catch {
      // Sem internet: tenta de novo depois.
    }
  }

  private set(state: UpdateState) {
    this.state = state;
    this.emit('change', state);
  }
}
