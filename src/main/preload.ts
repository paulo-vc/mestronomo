import { contextBridge, ipcRenderer } from 'electron';

const on = (channel: string) => (callback: (payload: any) => void) =>
  ipcRenderer.on(channel, (_event, payload) => callback(payload));

const invoke =
  (channel: string) =>
  (...args: unknown[]) =>
    ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('mestronomo', {
  estado: invoke('estado'),
  apps: invoke('apps'),
  som: invoke('som'),
  pararEfeitos: invoke('parar-efeitos'),
  capturar: invoke('capturar'),
  pararCaptura: invoke('parar-captura'),
  volumeCaptura: invoke('volume-captura'),
  volume: invoke('volume'),
  abrirSons: invoke('abrir-sons'),
  monitor: invoke('monitor'),
  monitorSaida: invoke('monitor-saida'),
  botEntrar: invoke('bot-entrar'),
  botSair: invoke('bot-sair'),
  configInfo: invoke('config-info'),
  configSalvar: invoke('config-salvar'),
  yt: {
    adicionar: invoke('yt-adicionar'),
    tocar: invoke('yt-tocar'),
    pausar: invoke('yt-pausar'),
    proxima: invoke('yt-proxima'),
    anterior: invoke('yt-anterior'),
    parar: invoke('yt-parar'),
    remover: invoke('yt-remover'),
    limpar: invoke('yt-limpar'),
    repetir: invoke('yt-repetir'),
  },
  onBot: on('bot'),
  onCapturas: on('capturas'),
  onYoutube: on('youtube'),
  onMixer: on('mixer'),
  onTocando: on('tocando'),
  onErro: on('erro'),
  onPcm: on('pcm'),
});
