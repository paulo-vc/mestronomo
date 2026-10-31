import { contextBridge, ipcRenderer } from 'electron';

const on = (channel: string) => (callback: (payload: any) => void) =>
  ipcRenderer.on(channel, (_event, payload) => callback(payload));

contextBridge.exposeInMainWorld('mestronomo', {
  estado: () => ipcRenderer.invoke('estado'),
  apps: () => ipcRenderer.invoke('apps'),
  som: (nome: string) => ipcRenderer.invoke('som', nome),
  pararEfeitos: () => ipcRenderer.invoke('parar-efeitos'),
  captura: (app: string | null) => ipcRenderer.invoke('captura', app),
  volume: (chave: string, valor: number) => ipcRenderer.invoke('volume', chave, valor),
  abrirSons: () => ipcRenderer.invoke('abrir-sons'),
  onBot: on('bot'),
  onCaptura: on('captura'),
  onMixer: on('mixer'),
  onTocando: on('tocando'),
  onErro: on('erro'),
});
