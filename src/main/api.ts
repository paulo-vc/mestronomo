import http from 'node:http';
import type { MixerSettings } from './mixer';
import type { LoopMode, YouTubePlayer } from './youtube';

export interface ApiActions {
  state(): unknown;
  listSounds(): string[];
  playSound(name: string): boolean;
  stopEffects(): void;
  startCapture(appName: string): void;
  stopCapture(appName?: string): void;
  setVolume(key: keyof MixerSettings | 'youtube', value: number): void;
  joinBot(): Promise<boolean> | boolean;
  leaveBot(): void;
  youtube: YouTubePlayer;
}

const VOLUME_KEYS = ['musica', 'efeitos', 'master', 'ducking', 'youtube'];
const LOOP_MODES: LoopMode[] = ['nenhum', 'fila', 'faixa'];

/**
 * API local para Ulanzi Studio / Stream Deck / qualquer coisa que abra uma URL.
 * Só escuta em 127.0.0.1. Tudo aceita GET para funcionar com ações simples de "abrir site".
 *
 *   /api/estado                          estado atual (JSON)
 *   /api/bot/entrar | /api/bot/sair      chama ou dispensa o bot
 *   /api/sons                            lista da soundboard
 *   /api/som/<arquivo ou número>         toca um efeito (número começa em 1)
 *   /api/efeitos/parar                   para todos os efeitos
 *   /api/musica/capturar/<app.exe>       adiciona a captura de um app
 *   /api/musica/parar[/<app.exe>]        para uma captura (ou todas)
 *   /api/youtube/adicionar?url=<link>    adiciona vídeo ou playlist à fila
 *   /api/youtube/<pausar|proxima|anterior|parar|limpar>
 *   /api/youtube/repetir/<nenhum|fila|faixa>
 *   /api/volume/<musica|efeitos|master|ducking|youtube>/<0-100>
 */
export function startApi(port: number, actions: ApiActions) {
  const { state, listSounds, playSound, stopEffects, startCapture, stopCapture, setVolume, joinBot, leaveBot, youtube } = actions;
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const parts = decodeURIComponent(url.pathname).split('/').filter(Boolean);
    const reply = (code: number, body: unknown) => {
      res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(body));
    };
    const ok = () => reply(200, { ok: true });
    if (parts[0] !== 'api') return reply(404, { erro: 'rota desconhecida' });

    const [, route, a, b] = parts;
    switch (route) {
      case 'estado':
        return reply(200, state());
      case 'bot':
        if (a === 'entrar') return reply(200, { ok: await joinBot() });
        leaveBot();
        return ok();
      case 'sons':
        return reply(200, listSounds());
      case 'som': {
        const sounds = listSounds();
        const name = /^\d+$/.test(a ?? '') ? sounds[Number(a) - 1] : a;
        return name && playSound(name) ? reply(200, { tocando: name }) : reply(404, { erro: 'som não encontrado' });
      }
      case 'efeitos':
        stopEffects();
        return ok();
      case 'musica':
        if (a === 'capturar' && b) startCapture(b);
        else stopCapture(b);
        return ok();
      case 'youtube':
        switch (a) {
          case 'adicionar': {
            const link = url.searchParams.get('url');
            if (!link) return reply(400, { erro: 'use /api/youtube/adicionar?url=<link>' });
            youtube.add(link);
            return ok();
          }
          case 'pausar': youtube.togglePause(); return ok();
          case 'proxima': youtube.next(); return ok();
          case 'anterior': youtube.previous(); return ok();
          case 'parar': youtube.stop(); return ok();
          case 'limpar': youtube.clear(); return ok();
          case 'repetir':
            if (!LOOP_MODES.includes(b as LoopMode)) return reply(400, { erro: 'use nenhum, fila ou faixa' });
            youtube.setLoop(b as LoopMode);
            return ok();
          default:
            return reply(404, { erro: 'rota desconhecida' });
        }
      case 'volume': {
        if (!VOLUME_KEYS.includes(a) || Number.isNaN(Number(b))) {
          return reply(400, { erro: `use /api/volume/<${VOLUME_KEYS.join('|')}>/<0-100>` });
        }
        setVolume(a as keyof MixerSettings | 'youtube', Number(b) / 100);
        return ok();
      }
      default:
        return reply(404, { erro: 'rota desconhecida' });
    }
  });
  server.on('error', (err) => console.error(`[api] não consegui abrir a porta ${port}:`, err.message));
  server.listen(port, '127.0.0.1');
}
