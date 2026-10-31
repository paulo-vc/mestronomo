# Mestrônomo

Ferramentas de áudio para mestres de RPG online. Um bot do Discord entra no seu canal de voz e transmite:

- **Música capturada de qualquer programa** (Spotify, navegador, YouTube…), sem VB-Cable nem conta secundária;
- **Soundboard** com atalhos globais (`Ctrl+Alt+1..9`, `Ctrl+Alt+0` para parar os efeitos);
- **Ducking**: a música abaixa sozinha enquanto um efeito toca.

## Como funciona

```
Spotify / navegador ──(mestronomo-capture)──┐
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
- `ffmpeg` no PATH

## Criando o bot no Discord

1. Acesse <https://discord.com/developers/applications> e clique em **New Application**. Dê o nome que quiser (ex.: Mestrônomo).
2. Aba **Installation**: em *Install Link*, escolha **None** e salve. Isso é necessário para conseguir tornar o bot privado.
3. Aba **Bot**:
   - Desmarque **Public Bot** para que só você possa adicionar o bot a servidores.
   - Clique em **Reset Token** e copie o token. **Não compartilhe com ninguém**: quem tem o token controla o bot.
   - Nenhum *Privileged Gateway Intent* é necessário.
4. Aba **OAuth2 → URL Generator**:
   - Scopes: `bot`
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

Entre num canal de voz e o bot vai atrás de você. Se você trocar de canal, ele segue; se sair, ele sai.

Coloque os efeitos na pasta `sons/`. A ordem alfabética define os atalhos, então use prefixos como `01 espada.mp3`.

## API local (Ulanzi Studio / Stream Deck)

Escuta só em `127.0.0.1:7777`. Todas as rotas aceitam GET, então funcionam com ações simples de "abrir URL":

| Rota | O que faz |
| --- | --- |
| `/api/som/3` ou `/api/som/espada.mp3` | Toca um efeito |
| `/api/efeitos/parar` | Para todos os efeitos |
| `/api/musica/capturar/Spotify.exe` | Começa a capturar um app |
| `/api/musica/parar` | Para a captura |
| `/api/volume/musica/60` | Volume (`musica`, `efeitos`, `master`, `ducking`) de 0 a 100 |
| `/api/estado` | Estado atual em JSON |

## Aviso sobre Spotify

A captura funciona com qualquer programa, mas retransmitir o Spotify para outras pessoas vai contra os termos de uso dele. Para uso entre amigos o risco é baixo; se um dia quiser distribuir o Mestrônomo, prefira arquivos locais ou trilhas com licença livre.
