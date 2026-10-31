import { Menu, Tray, nativeImage } from 'electron';
import path from 'node:path';
import { ROOT } from './paths';

export interface TrayActions {
  show(): void;
  quit(): void;
  isBotInCall(): boolean;
  toggleBot(): void;
  stopEffects(): void;
  isAutoStart(): boolean;
  setAutoStart(enabled: boolean): void;
  invite(): void;
}

/** Ícone na bandeja: o app continua rodando com a janela fechada. */
export function createTray(actions: TrayActions) {
  const tray = new Tray(nativeImage.createFromPath(path.join(ROOT, 'assets', 'icon.ico')));
  tray.setToolTip('Mestrônomo');
  tray.on('click', actions.show);

  const rebuild = () =>
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Abrir Mestrônomo', click: actions.show },
        { type: 'separator' },
        { label: actions.isBotInCall() ? 'Dispensar bot' : 'Chamar bot', click: actions.toggleBot },
        { label: 'Parar efeitos', click: actions.stopEffects },
        { label: 'Convidar o bot para um servidor…', click: actions.invite },
        { type: 'separator' },
        {
          label: 'Iniciar com o Windows',
          type: 'checkbox',
          checked: actions.isAutoStart(),
          click: (item) => actions.setAutoStart(item.checked),
        },
        { type: 'separator' },
        { label: 'Sair', click: actions.quit },
      ]),
    );
  rebuild();
  // O menu mostra o estado do bot, então é refeito quando ele muda.
  return { tray, rebuild };
}
