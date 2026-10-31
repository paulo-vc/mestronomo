<p align="center"><img src="assets/logo.svg" alt="Mestrônomo — o ritmo da sua mesa" width="520"></p>

Ferramentas de áudio para mestres de RPG online. Um bot do Discord entra no seu canal de voz e transmite:

- **Música capturada de um ou mais programas ao mesmo tempo** (Spotify, navegador…), cada um com seu volume, sem VB-Cable nem conta secundária;
- **Player de YouTube** com fila, playlists, pausa e repetição;
- **Soundboard** com atalhos globais (`Ctrl+Alt+1..9`, `Ctrl+Alt+0` para parar os efeitos);
- **Ducking**: a música abaixa sozinha enquanto um efeito toca;
- **Monitor no seu fone** e **pré-escuta** (botão direito num som toca só para você).

## Como funciona

```
Spotify / navegador ──(mestronomo-capture)──┐
Links do YouTube ──(yt-dlp + ffmpeg)────────┤
Efeitos (pasta sons/, via ffmpeg) ──────────┼─► Mixer (20 ms, Opus) ─► Bot no canal de voz
                                            │
Ulanzi / Stream Deck ──► API local :7777 ───┘
```

- `capture/`: executável em Rust que captura o áudio de **um app específico** (WASAPI process loopback, Windows 10 2004+).
- `src/main/`: processo principal do Electron (mixer, bot, API local).
- `src/renderer/`: interface.

## Requisitos

- Windows 10 (2004) ou 11
- Node.js 22+ e Rust (`cargo`)
- `ffmpeg` e `yt-dlp` no PATH (`winget install yt-dlp.yt-dlp`)

## Criando o bot no Discord

1. Acesse <https://discord.com/developers/applications> e clique em **New Application**. Dê o nome que quiser (ex.: Mestrônomo).
2. Aba **Installation**: em *Install Link*, escolha **None** e salve. Isso é necessário para conseguir tornar o bot privado.
3. Aba **Bot**:
   - Desmarque **Public Bot** para que só você possa adicionar o bot a servidores.
   - Clique em **Reset Token** e copie o token. **Não compartilhe com ninguém**: quem tem o token controla o bot.
   - Nenhum *Privileged Gateway Intent* é necessário.
4. Aba **OAuth2 → URL Generator**:
   - Scopes: `bot` e `applications.commands` (para os comandos `/entrar` e `/sair`)
   - Bot Permissions: `View Channels`, `Connect`, `Speak`
   - Abra a URL gerada no navegador e escolha o servidor da mesa.
5. No Discord, ative **Configurações → Avançado → Modo desenvolvedor**. Depois clique com o botão direito no seu próprio nome e escolha **Copiar ID do usuário**.

## Configuração

Copie `.env.example` para `.env` e preencha:

```
DISCORD_TOKEN=token-do-passo-3
DISCORD_OWNER_ID=seu-id-do-passo-5
```

## Rodando

```bash
npm install
npm run build:capture   # só na primeira vez (ou quando mexer em capture/)
npm start
```

O bot fica online mas só entra na call quando você chama:

- `/entrar` no Discord: entra no canal de voz em que você está (só o dono, definido em `DISCORD_OWNER_ID`, pode usar);
- `/sair` no Discord, ou o botão **Dispensar bot** no app;
- botão **Chamar bot** no app, ou `/api/bot/entrar` (Ulanzi).

Ele sai sozinho quando não sobra nenhuma pessoa no canal.

## Volumes

Cada som passa por três controles, multiplicados entre si:

```
volume da fonte  ×  volume do grupo  ×  Geral
(cada app, YouTube)  (Música ou Efeitos)
```

- **Geral**: tudo que sai pelo bot.
- **Música**: todos os programas capturados e o YouTube juntos.
- **Efeitos**: a soundboard.
- **Ducking**: para quanto a música cai enquanto um efeito toca. Com 35%, a música abaixa para 35% do volume e volta sozinha. 100% desliga o ducking.

### Seu fone (monitor)

Escolha o dispositivo de saída e o que ouvir:

- **Ouvir efeitos e YouTube** (padrão): tudo que vai para a call, menos os programas capturados, que você já ouve direto no PC.
- **Ouvir tudo**: exatamente o que os jogadores ouvem.
- **Só pré-escuta**: apenas os sons que você testa com o botão direito.
- **Não ouvir**.

O volume do fone não muda o que vai para a call.

## Soundboard

Coloque os efeitos na pasta `sons/`. A ordem alfabética define os atalhos, então use prefixos como `01 espada.mp3`.

## API local (Ulanzi Studio / Stream Deck)

Escuta só em `127.0.0.1:7777`. Todas as rotas aceitam GET, então funcionam com ações simples de "abrir URL":

| Rota | O que faz |
| --- | --- |
| `/api/som/3` ou `/api/som/espada.mp3` | Toca um efeito |
| `/api/previa/3` | Toca um efeito só no seu fone |
| `/api/efeitos/parar` | Para todos os efeitos |
| `/api/bot/entrar` · `/api/bot/sair` | Chama ou dispensa o bot |
| `/api/musica/capturar/Spotify.exe` | Adiciona a captura de um app |
| `/api/musica/parar/Spotify.exe` | Para uma captura (sem o nome, para todas) |
| `/api/youtube/adicionar?url=<link>` | Adiciona vídeo ou playlist à fila |
| `/api/youtube/pausar` · `proxima` · `anterior` · `parar` · `limpar` | Controles do player |
| `/api/youtube/repetir/fila` | Repetição: `nenhum`, `fila` ou `faixa` |
| `/api/volume/musica/60` | Volume (`musica`, `efeitos`, `master`, `ducking`, `youtube`, `monitorVolume`) de 0 a 100 |
| `/api/estado` | Estado atual em JSON |

## Plugin do Ulanzi Studio

A pasta `ulanzi-plugin/` tem um plugin para o Ulanzi Studio com sete ações, todas mostrando o estado ao vivo na tecla:

| Ação | O que faz | Na tecla |
| --- | --- | --- |
| Tocar Som | Toca um som da soundboard (ou só no seu fone, com "pré-escuta") | Nome do som |
| YouTube Tocar/Pausar | Toca ou pausa a fila | ▶/⏸ e o título da faixa |
| YouTube Próxima | Pula para a próxima faixa | Título da próxima |
| Parar Efeitos | Para todos os efeitos | Acende enquanto há efeito tocando |
| Chamar / Dispensar Bot | Leva o bot para a sua call, ou dispensa | Nome do canal / "CHAMAR BOT" |
| Volume | Sobe ou desce um volume (música, efeitos, geral, YouTube, fone) | Volume atual |
| Capturar App | Liga ou desliga a captura de um app | Nome do app e ON quando ativo |

Para instalar:

```bash
npm run plugin:ulanzi
```

Depois reinicie o Ulanzi Studio: as ações aparecem na categoria **Mestrônomo**. Com o Mestrônomo fechado, as teclas mostram "Abra o Mestrônomo".

## Aviso sobre Spotify e YouTube

A captura e o player funcionam, mas retransmitir o Spotify ou o YouTube para outras pessoas vai contra os termos de uso dele. Para uso entre amigos o risco é baixo; se um dia quiser distribuir o Mestrônomo, prefira arquivos locais ou trilhas com licença livre.

## Licença

MIT. Veja [LICENSE](LICENSE).
