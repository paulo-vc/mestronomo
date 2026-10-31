import http from 'node:http';
import type { VolumeKey } from './mixer';
import type { LoopMode, YouTubePlayer } from './youtube';
import type { Ambience } from './ambience';
import type { SceneManager } from './scenes';

export interface ApiActions {
  state(): unknown;
  listSounds(): string[];
  listApps(): Promise<unknown>;
  playSound(name: string, preview?: boolean): boolean;
  stopEffects(): void;
  startCapture(appName: string): void;
  stopCapture(appName?: string): void;
  setVolume(key: VolumeKey | 'youtube', value: number): void;
  joinBot(): Promise<boolean> | boolean;
  leaveBot(): void;
  youtube: YouTubePlayer;
  ambience: Ambience;
  scenes: SceneManager;
}

const VOLUME_KEYS = ['musica', 'efeitos', 'ambiente', 'master', 'ducking', 'monitorVolume', 'youtube'];
const LOOP_MODES: LoopMode[] = ['nenhum', 'fila', 'faixa'];

/**
 * API local para Ulanzi Studio / Stream Deck / qualquer coisa que abra uma URL.
 * Só escuta em 127.0.0.1. Tudo aceita GET para funcionar com ações simples de "abrir site".
 *
 *   /api/estado                          estado atual (JSON)
 *   /api/bot/entrar | /api/bot/sair      chama ou dispensa o bot
 *   /api/sons                            lista da soundboard
 *   /api/apps                            apps com áudio que dá para capturar
 *   /api/som/<id, nome ou número>        toca um efeito (número começa em 1)
 *   /api/previa/<arquivo ou número>      toca um efeito só no fone do mestre
 *   /api/efeitos/parar                   para todos os efeitos
 *   /api/musica/capturar/<app.exe>       adiciona a captura de um app
 *   /api/musica/parar[/<app.exe>]        para uma captura (ou todas)
 *   /api/youtube/adicionar?url=<link>    adiciona vídeo ou playlist à fila
 *   /api/youtube/<pausar|proxima|anterior|parar|limpar>
 *   /api/youtube/repetir/<nenhum|fila|faixa>
 *   /api/cenas                           lista de cenas
 *   /api/cena/<nome ou número>           ativa uma cena (crossfade)
 *   /api/ambiente/<arquivo>              liga/desliga uma camada de ambiente
 *   /api/ambiente/parar                  desliga todo o ambiente
 *   /api/volume/<musica|efeitos|master|ducking|youtube>/<0-100>
 */
export function startApi(port: number, actions: ApiActions) {
  const { state, listSounds, listApps, playSound, stopEffects, startCapture, stopCapture, setVolume, joinBot, leaveBot, youtube, ambience, scenes } = actions;
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    // Divide antes de decodificar: ids de som têm "/" (ex.: Combate%2Fespada).
    const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
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
      case 'apps':
        try {
          return reply(200, await listApps());
        } catch {
          return reply(500, { erro: 'capturador não encontrado (npm run build:capture)' });
        }
      case 'som':
      case 'previa':
        // Aceita id ("Combate/espada"), nome, arquivo ou posição (1 = primeiro).
        return a && playSound(a, route === 'previa') ? reply(200, { tocando: a }) : reply(404, { erro: 'som não encontrado' });
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
      case 'cenas':
        return reply(200, scenes.state());
      case 'cena':
        return a && scenes.activate(a) ? ok() : reply(404, { erro: 'cena não encontrada' });
      case 'ambiente':
        if (!a) return reply(400, { erro: 'use /api/ambiente/<arquivo> ou /api/ambiente/parar' });
        if (a === 'parar') ambience.stopAll(1500);
        else ambience.toggle(a);
        return ok();
      case 'volume': {
        if (!VOLUME_KEYS.includes(a) || Number.isNaN(Number(b))) {
          return reply(400, { erro: `use /api/volume/<${VOLUME_KEYS.join('|')}>/<0-100>` });
        }
        setVolume(a as VolumeKey | 'youtube', Number(b) / 100);
        return ok();
      }
      default:
        return reply(404, { erro: 'rota desconhecida' });
    }
  });
  server.on('error', (err) => console.error(`[api] não consegui abrir a porta ${port}:`, err.message));
  server.listen(port, '127.0.0.1');
}
