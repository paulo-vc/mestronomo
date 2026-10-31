import http from 'node:http';
import type { MixerSettings } from './mixer';

export interface ApiActions {
  state(): unknown;
  listSounds(): string[];
  playSound(name: string): boolean;
  stopEffects(): void;
  startCapture(appName: string): void;
  stopCapture(): void;
  setVolume(key: keyof MixerSettings, value: number): void;
}

/**
 * API local para Ulanzi Studio / Stream Deck / qualquer coisa que abra uma URL.
 * Só escuta em 127.0.0.1. Tudo aceita GET para funcionar com ações simples de "abrir site".
 *
 *   /api/estado                    estado atual (JSON)
 *   /api/sons                      lista da soundboard
 *   /api/som/<arquivo ou número>   toca um efeito (número começa em 1)
 *   /api/efeitos/parar             para todos os efeitos
 *   /api/musica/capturar/<app.exe> começa a capturar um app
 *   /api/musica/parar              para a captura
 *   /api/volume/<musica|efeitos|master|ducking>/<0-100>
 */
export function startApi(port: number, actions: ApiActions) {
  const { state, listSounds, playSound, stopEffects, startCapture, stopCapture, setVolume } = actions;
  const server = http.createServer((req, res) => {
    const parts = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname).split('/').filter(Boolean);
    const reply = (code: number, body: unknown) => {
      res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(body));
    };
    if (parts[0] !== 'api') return reply(404, { erro: 'rota desconhecida' });

    const [, route, a, b] = parts;
    switch (route) {
      case 'estado':
        return reply(200, state());
      case 'sons':
        return reply(200, listSounds());
      case 'som': {
        const sounds = listSounds();
        const name = /^\d+$/.test(a ?? '') ? sounds[Number(a) - 1] : a;
        return name && playSound(name) ? reply(200, { tocando: name }) : reply(404, { erro: 'som não encontrado' });
      }
      case 'efeitos':
        stopEffects();
        return reply(200, { ok: true });
      case 'musica':
        if (a === 'capturar' && b) startCapture(b);
        else stopCapture();
        return reply(200, { ok: true });
      case 'volume': {
        const key = a as 'musica' | 'efeitos' | 'master' | 'ducking';
        if (!['musica', 'efeitos', 'master', 'ducking'].includes(key) || Number.isNaN(Number(b))) {
          return reply(400, { erro: 'use /api/volume/<musica|efeitos|master|ducking>/<0-100>' });
        }
        setVolume(key, Number(b) / 100);
        return reply(200, { ok: true });
      }
      default:
        return reply(404, { erro: 'rota desconhecida' });
    }
  });
  server.on('error', (err) => console.error(`[api] não consegui abrir a porta ${port}:`, err.message));
  server.listen(port, '127.0.0.1');
}
