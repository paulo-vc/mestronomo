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

/** Resposta do "Buscar atualizações" manual. */
export interface CheckResult {
  ok: boolean;
  mensagem: string;
}

export class Updater extends EventEmitter {
  state: UpdateState = { estado: 'nenhuma' };
  private timer?: NodeJS.Timeout;
  private started = false;
  private pendingVersion = '';

  constructor(private portable: boolean) {
    super();
  }

  /** auto=false: só busca quando a pessoa pede (botão "Buscar atualizações"). */
  start(auto = true) {
    if (!app.isPackaged || this.started) return;
    this.started = true;
    if (!this.portable) {
      autoUpdater.autoDownload = true;
      autoUpdater.autoInstallOnAppQuit = true;
      autoUpdater.on('download-progress', (p) => this.set({ estado: 'baixando', versao: this.pendingVersion, progresso: Math.round(p.percent) }));
      autoUpdater.on('update-available', (info) => (this.pendingVersion = info.version));
      autoUpdater.on('update-downloaded', (info) => this.set({ estado: 'pronta', versao: info.version }));
      // Sem internet ou release sem latest.yml: tenta de novo no próximo intervalo, sem incomodar.
      autoUpdater.on('error', (err) => console.warn('[atualização]', err.message));
    }
    this.setAuto(auto);
  }

  /** Liga ou desliga a busca automática (ao abrir e a cada 6 horas). */
  setAuto(auto: boolean) {
    clearInterval(this.timer);
    this.timer = undefined;
    if (!auto || !this.started) return;
    this.check();
    this.timer = setInterval(() => this.check(), INTERVALO_MS);
    this.timer.unref();
  }

  /** Reinicia instalando a atualização já baixada. */
  installNow() {
    if (this.state.estado === 'pronta') autoUpdater.quitAndInstall(false, true);
  }

  /** Busca agora e diz o resultado em uma frase. */
  async checkNow(): Promise<CheckResult> {
    if (!app.isPackaged) return { ok: false, mensagem: 'A busca de atualizações só funciona na versão instalada ou portátil.' };
    if (this.state.estado === 'pronta') return { ok: true, mensagem: `A versão ${this.state.versao} já foi baixada. Reinicie para instalar.` };
    if (this.state.estado === 'baixando') return { ok: true, mensagem: `Baixando a versão ${this.state.versao}…` };
    try {
      const versao = await this.check(true);
      if (versao && isNewer(versao, app.getVersion())) {
        return {
          ok: true,
          mensagem: this.portable ? `Versão ${versao} disponível. Use o botão no topo para baixar.` : `Versão ${versao} encontrada. Baixando…`,
        };
      }
      return { ok: true, mensagem: `Você já está na versão mais recente (${app.getVersion()}).` };
    } catch (err) {
      return { ok: false, mensagem: `Não consegui verificar agora (${(err as Error).message}). Confira a internet e tente de novo.` };
    }
  }

  /** Devolve a versão mais nova publicada. Na busca automática, erros (sem internet) são silenciosos. */
  private async check(manual = false): Promise<string | undefined> {
    try {
      if (!this.portable) return (await autoUpdater.checkForUpdates())?.updateInfo.version;
      const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } });
      if (!res.ok) throw new Error(`GitHub respondeu ${res.status}`);
      const versao = String(((await res.json()) as { tag_name: string }).tag_name).replace(/^v/, '');
      if (isNewer(versao, app.getVersion())) this.set({ estado: 'disponivel', versao, url: RELEASES });
      return versao;
    } catch (err) {
      if (manual) throw err;
      console.warn('[atualização]', (err as Error).message);
      return undefined;
    }
  }

  private set(state: UpdateState) {
    this.state = state;
    this.emit('change', state);
  }
}
