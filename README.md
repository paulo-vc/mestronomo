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
- Node.js 22+ e Rust (`cargo`) — só para compilar; o instalador não precisa de nada disso
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
   - Bot Permissions: `View Channels`, `Connect`, `Speak`, `Send Messages`, `Embed Links`, `Attach Files`
   - Abra a URL gerada no navegador e escolha o servidor da mesa.
5. No Discord, ative **Configurações → Avançado → Modo desenvolvedor**. Depois clique com o botão direito no seu próprio nome e escolha **Copiar ID do usuário**.

## Configuração

Clique no **⚙** no topo do app e cole o token (passo 3) e o seu ID (passo 5). O token fica guardado **criptografado** pelo Windows, atrelado ao seu usuário.

Para desenvolvimento, dá também para usar um `.env` (copie `.env.example`); ele tem prioridade sobre a tela.

## Instalador

```bash
npm run dist
```

Gera `release/Mestrônomo Setup <versão>.exe`, que já leva o capturador, o ffmpeg e o yt-dlp (copiados do seu PATH). Instalado:

- os sons ficam em `Documentos\Mestrônomo\sons`;
- fechar a janela deixa o app na **bandeja** (o bot e os atalhos continuam funcionando); para sair, use **Sair** no ícone;
- "Iniciar com o Windows" (no ⚙ ou no menu da bandeja) abre o app direto na bandeja.

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

## Comandos no Discord

| Comando | Quem pode | O que faz |
| --- | --- | --- |
| `/entrar` · `/sair` | Mestre | Chama o bot para o seu canal de voz, ou dispensa |
| `/r 2d20kh1+5` | Todos | Rola dados. Aceita `NdM`, `kh`/`kl` (manter maiores/menores), `d%`, somas e subtrações, e os atalhos `vantagem` e `desvantagem`. Destaca 20 e 1 naturais no d20. Com `secreto: True`, só quem rolou vê |
| `/canal` | Mestre | Escolhe o canal de texto para a mensagem **tocando agora** e para os **handouts** |

**Tocando agora**: o bot mantém uma mensagem no canal escolhido mostrando a música, a cena e o ambiente, editada sozinha quando algo muda (dá para desligar no ⚙).

**Handouts**: o botão 🖼 no topo do app manda uma imagem (mapa, retrato, carta…) com legenda opcional para esse canal.

> Se você convidou o bot antes destes recursos, dê a ele as permissões **Send Messages**, **Embed Links** e **Attach Files** (pelo cargo do bot no servidor, ou convidando de novo com a URL nova).

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

## Player (YouTube e músicas locais)

- **Link**: cole um link de vídeo ou playlist do YouTube (ou de outro site que o yt-dlp suporte).
- **Busca**: digite um texto (ex.: "tavern music") e escolha entre os 5 primeiros resultados.
- **Músicas locais**: cada subpasta de `musicas/` vira uma playlist (instalado: `Documentos\Mestrônomo\musicas`); escolha e clique em **Pôr na fila**. Links e arquivos locais podem ficar na mesma fila.

## Cenas

Monte o clima (camadas de ambiente, sons ocasionais e, se quiser, a fila do YouTube) e clique em **Salvar cena atual**. Depois, um clique na cena troca tudo com **crossfade** (duração ajustável em "Transição"). Para cada cena você escolhe o que fazer com a música: usar a fila atual do YouTube, parar a música ou não mexer nela.

Também funciona por `/api/cena/Taverna` (ou `/api/cena/1`) e pela ação **Cena** do plugin do Ulanzi, que acende a tecla da cena ativa.

## Ambiente

Coloque sons contínuos (chuva, fogueira, vento, taverna…) na pasta `ambientes/` (instalado: `Documentos\Mestrônomo\ambientes`). No cartão **Ambiente**:

- clique num arquivo para ligar a camada em **loop** (entra e sai com fade); várias tocam juntas, cada uma com seu volume;
- **sons ocasionais**: escolha um ou mais arquivos e um intervalo (ex.: a cada 30–90 s); um deles é sorteado a cada vez, com uma leve variação de volume.

Prefira `.ogg` ou `.wav` para loops sem emenda. O volume do grupo é o slider **Ambiente** do mixer.

## Soundboard

Coloque os efeitos na pasta `sons/` (instalado: `Documentos\Mestrônomo\sons`):

- **Subpastas viram abas** (`sons/Combate`, `sons/Magia`…); arquivos soltos ficam em "Geral".
- **Variações**: arquivos com o mesmo nome e um número no fim (`espada 1.mp3`, `espada 2.mp3`, `espada (3).ogg`) viram **um botão** que sorteia entre eles, sem repetir o último.
- **⋯ em cada botão**: volume próprio, **loop** (clique liga e desliga; loops não abaixam a música) e cor.
- **Botão direito**: pré-escuta, só no seu fone.
- **Atalhos**: `Ctrl+Alt+1..9` tocam os nove primeiros; `Ctrl+Alt+0` para todos os efeitos (inclusive loops). Use prefixos como `01 `, `02 ` para controlar a ordem.

## API local (Ulanzi Studio / Stream Deck)

Escuta só em `127.0.0.1:7777`. Todas as rotas aceitam GET, então funcionam com ações simples de "abrir URL":

| Rota | O que faz |
| --- | --- |
| `/api/som/3`, `/api/som/espada` ou `/api/som/Combate%2Fespada` | Toca um efeito (posição, nome ou id) |
| `/api/previa/3` | Toca um efeito só no seu fone |
| `/api/cena/Taverna` ou `/api/cena/1` | Ativa uma cena |
| `/api/ambiente/chuva.ogg` · `/api/ambiente/parar` | Liga/desliga uma camada · para todo o ambiente |
| `/api/efeitos/parar` | Para todos os efeitos |
| `/api/bot/entrar` · `/api/bot/sair` | Chama ou dispensa o bot |
| `/api/musica/capturar/Spotify.exe` | Adiciona a captura de um app |
| `/api/musica/parar/Spotify.exe` | Para uma captura (sem o nome, para todas) |
| `/api/youtube/adicionar?url=<link>` | Adiciona vídeo ou playlist à fila |
| `/api/youtube/buscar?q=<texto>` | Busca e põe o primeiro resultado na fila |
| `/api/youtube/pasta/Taverna` | Põe uma pasta de músicas locais na fila |
| `/api/youtube/pausar` · `proxima` · `anterior` · `parar` · `limpar` | Controles do player |
| `/api/youtube/repetir/fila` | Repetição: `nenhum`, `fila` ou `faixa` |
| `/api/volume/musica/60` | Volume (`musica`, `efeitos`, `master`, `ducking`, `youtube`, `monitorVolume`) de 0 a 100 |
| `/api/estado` | Estado atual em JSON |

## Plugin do Ulanzi Studio

A pasta `ulanzi-plugin/` tem um plugin para o Ulanzi Studio com oito ações, todas mostrando o estado ao vivo na tecla:

| Ação | O que faz | Na tecla |
| --- | --- | --- |
| Cena | Troca para uma cena com crossfade | Nome da cena; acesa quando ativa |
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
