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

## Configurando o bot

Cada mestre usa o **próprio bot** (é de graça e leva uns 2 minutos). Um bot único compartilhado exigiria pôr o token dele dentro do app, onde qualquer um poderia extraí-lo e tomar o controle.

No app, clique em **⚙** e siga os três passos:

1. **Abrir o Discord Developer Portal** → *New Application* → dê um nome → aba **Bot** → **Reset Token** e copie. (Opcional: em *Installation*, deixe *Install Link* em "None" e desmarque *Public Bot* para que só você possa adicioná-lo.)
2. **Cole o token** e clique em **Verificar**: o app confere o token e mostra o nome do bot e o dono.
3. **Convidar o bot**: abre o convite já com as permissões certas (ver canais, conectar, falar, enviar mensagens, links e arquivos). Escolha o servidor da mesa e **Salvar**.

Quem criou o bot é o mestre (só ele usa `/entrar`, `/sair` e `/canal`). Para outra pessoa mestrar com o seu bot, coloque o ID dela em **Avançado**. O token fica guardado **criptografado** pelo Windows; em desenvolvimento, um `.env` (veja `.env.example`) tem prioridade.

O convite também está no menu do ícone da bandeja.

## Testes

```bash
npm test
```

Compila e roda os testes de `test/` (mixer, filtros, cache de áudio, dados, combate, cenas, pacotes, backup e o roteamento de mensagens do bot com um Discord simulado). Os que precisam do ffmpeg são pulados se ele não estiver no PATH. O GitHub Actions roda tudo a cada push e pull request (`.github/workflows/ci.yml`).

## Instalador e versão portátil

Baixe em [Releases](https://github.com/paulo-vc/mestronomo/releases):

- **Mestronomo-Setup-x.y.z.exe**: instalador. Os arquivos ficam em `Documentos\Mestrônomo`.
- **Mestronomo-Portatil-x.y.z.zip**: descompacte em qualquer lugar (até num pendrive) e abra `Mestronomo.exe`. Tudo fica na pasta `Dados` ao lado do programa. O token do bot é criptografado para o seu usuário do Windows; em outro PC, cole de novo.

Para gerar os dois:

```bash
npm run dist
```

Gera os dois em `release/<versão>/`, que já levam o capturador, o ffmpeg e o yt-dlp (copiados do seu PATH). Instalado:

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

## Mesa (ferramentas do mestre)

Na página **Sessão**, ao lado do roteiro, o cartão da mesa tem quatro abas:

- **Combate**: adicione jogadores e criaturas. No campo de iniciativa, `15` define, `+3` rola 1d20+3 e vazio rola 1d20. A lista se ordena sozinha; no campo de HP, `-7` causa dano, `+5` cura e `30` define. **Começar combate** pode ativar uma cena (ex.: "Combate") e **Encerrar** volta para a cena de antes. Opcionalmente anuncia "vez de Fulano" no canal do `/canal` (⚙ → Discord). O combate sobrevive a fechar o app.
- **Timers**: contagens regressivas ("a tocha apaga em 10 min"; o tempo aceita `10` ou `1:30`) que avisam e podem tocar um som da soundboard no fim.
- **Tabelas**: cada `.txt` da pasta `tabelas/` é uma tabela aleatória, uma opção por linha. `3x` no começo dá peso e `[[1d6]]` é rolado na hora. O resultado pode ir para o Discord. Há dois exemplos na pasta.
- **Registro**: o que aconteceu na sessão (cenas, momentos, combates, críticos, músicas), que pode virar um resumo no Discord.

## Comandos no Discord

| Comando | Quem pode | O que faz |
| --- | --- | --- |
| `/entrar` · `/sair` | Mestre | Chama o bot para o seu canal de voz, ou dispensa |
| `/r 2d20kh1+5` | Todos | Rola dados. Aceita `NdM`, `kh`/`kl` (manter maiores/menores), `d%`, somas e subtrações, e os atalhos `vantagem` e `desvantagem`. Destaca 20 e 1 naturais no d20. Com `secreto: True`, só quem rolou vê |
| `/canal` | Mestre | Escolhe, **neste servidor**, o canal de texto da mensagem **tocando agora**, dos handouts e dos avisos. Cada servidor tem o seu. |
| `/iniciativa bonus:3` | Todos | Rola 1d20 + bônus e entra (ou atualiza) na ordem de combate do app |
| `/ordem` | Todos | Mostra a ordem de combate, sem revelar HP |
| `/musica link` | Todos | Pede uma música; aparece no app para o mestre aprovar (do mestre, toca direto) |
| `/som nome` | Todos | Pede um efeito da soundboard (com autocompletar); mesmo esquema de aprovação |
| `/resumo` | Mestre | Posta o resumo da sessão: cenas, momentos, combates, críticos, músicas e pedidos |

**Onde o bot escreve**: só no servidor da mesa — o da call em que o bot está (ou, para envios feitos por você no app, o da call em que você está). Mensagens automáticas, como turnos e "tocando agora", só saem enquanto o bot estiver numa call; os outros servidores em que ele está nunca recebem nada.

**Tocando agora**: o bot mantém uma mensagem no canal escolhido mostrando a música, a cena e o ambiente, editada sozinha quando algo muda (dá para desligar no ⚙).

**Handouts**: o botão 🖼 no topo do app manda uma imagem (mapa, retrato, carta…) com legenda opcional para esse canal.

> Se você convidou o bot antes destes recursos, dê a ele as permissões **Send Messages**, **Embed Links** e **Attach Files** (pelo cargo do bot no servidor, ou convidando de novo com a URL nova).

## Backup

Em **⚙ → Backup**, **Exportar…** gera um `.zip` com cenas, soundboard, volumes, combate e o resto das configurações, e (opcional) as pastas de sons, ambientes, músicas e tabelas. **Importar…** aplica o backup em outro PC (ou na versão portátil) e reinicia o app. O token do bot nunca vai no backup.

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

## Pacotes de sons

O app vem com dois pacotes prontos, todos em domínio público (CC0): **Medieval** (espadas, magia, criaturas, taverna, floresta, masmorra) e **Moderno** (tiros, sirenes, telefone, cidade, escritório, tempestade). Na primeira vez que abre, o Mestrônomo pergunta quais instalar; depois, dá para instalar ou remover em **Sons → + Mais sons**. Cada pacote traz efeitos (`sons/<Pacote>/<Categoria>`), ambientes em loop (`ambientes/<Pacote>`) e cenas de exemplo. Os créditos ficam em `CREDITOS.txt`.

Para refazer os pacotes a partir das fontes (`pacotes/fontes.json`): extraia os zips da Kenney indicados lá numa pasta e rode `node scripts/montar-pacotes.js <pasta>`.

## Roteiro da sessão

Na página **Sessão** (`Ctrl+1`), prepare a sessão em **momentos** ("Chegada à taverna", "A briga", "Fuga pela floresta"). Cada momento pode ter notas (o que narrar, falas de NPCs), uma cena que entra junto, atalhos de sons e um handout. Durante o jogo, **Próximo momento** (ou `/api/roteiro/proximo`, ou a tecla Próximo Momento do Ulanzi) troca a cena e mostra tudo daquele trecho.

## Filtros de ambiente

**Abafado** (atrás da porta, debaixo d'água), **Caverna** (reverberação) e **Eco** mudam todo o som da mesa. Ficam na barra de baixo, e as cenas salvam os filtros ligados.

## Freesound

Em **Sons → + Mais sons**, busque efeitos gratuitos no [Freesound](https://freesound.org), ouça a prévia e baixe direto para a soundboard ou para o ambiente. Precisa de uma chave de API gratuita (⚙ → Geral). Os créditos ficam em `CREDITOS-freesound.txt`.

## Atualização automática

A versão instalada baixa as atualizações sozinha e mostra **Atualização pronta — reiniciar** no topo. A portátil avisa que há versão nova e abre a página de download.

## Cenas

Monte o clima (camadas de ambiente, sons ocasionais e, se quiser, a fila do YouTube) e clique em **+ Salvar o que está tocando** (página **Sons**). Depois, um clique na cena troca tudo com **crossfade** (duração em ⚙ → Áudio → Transições). Se o player tiver uma fila, a cena guarda essa fila; senão, não mexe na música.

Também funciona por `/api/cena/Taverna` (ou `/api/cena/1`) e pela ação **Cena** do plugin do Ulanzi, que acende a tecla da cena ativa.

## Ambiente

Coloque sons contínuos (chuva, fogueira, vento, taverna…) na pasta `ambientes/` (instalado: `Documentos\Mestrônomo\ambientes`). No cartão **Ambiente** da página **Sons** (`Ctrl+3`):

- clique num arquivo para ligar a camada em **loop** (entra e sai com fade); várias tocam juntas, cada uma com seu volume;
- **sons ocasionais**: escolha um ou mais arquivos e um intervalo (ex.: a cada 30–90 s); um deles é sorteado a cada vez, com uma leve variação de volume.

Prefira `.ogg` ou `.wav` para loops sem emenda. O volume do grupo é o slider **Ambiente** em ⚙ → Áudio.

## Efeitos (soundboard)

Coloque os efeitos na pasta `sons/` (instalado: `Documentos\Mestrônomo\sons`):

- **Subpastas viram abas** (`sons/Combate`, `sons/Magia`…); arquivos soltos ficam em "Geral".
- **Variações**: arquivos com o mesmo nome e um número no fim (`espada 1.mp3`, `espada 2.mp3`, `espada (3).ogg`) viram **um botão** que sorteia entre eles, sem repetir o último.
- **⋯ em cada botão**: volume próprio e **loop** (clique liga e desliga; loops não abaixam a música).
- **Botão direito**: pré-escuta, só no seu fone.
- **Atalhos**: por padrão `Ctrl+Alt+1..9` tocam os nove primeiros e `Ctrl+Alt+0` para todos os efeitos (inclusive loops). Em **⚙ → Atalhos** dá para trocar as teclas e criar atalhos para sons específicos, cenas, roteiro, filtros, player, turno e bot; o app avisa quando outro programa já usa a combinação.

## API local (Ulanzi Studio / Stream Deck)

Escuta só em `127.0.0.1:7777`. Todas as rotas aceitam GET, então funcionam com ações simples de "abrir URL":

| Rota | O que faz |
| --- | --- |
| `/api/som/3`, `/api/som/espada` ou `/api/som/Combate%2Fespada` | Toca um efeito (posição, nome ou id) |
| `/api/previa/3` | Toca um efeito só no seu fone |
| `/api/cena/Taverna` ou `/api/cena/1` | Ativa uma cena |
| `/api/ambiente/chuva.ogg` · `/api/ambiente/parar` | Liga/desliga uma camada · para todo o ambiente |
| `/api/combate/proximo` (`iniciar`, `anterior`, `encerrar`) | Controla o combate |
| `/api/tabela/<nome>` | Rola uma tabela e devolve o resultado |
| `/api/timer?min=10&nome=Tocha` | Começa um timer |
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

A pasta `ulanzi-plugin/` tem um plugin para o Ulanzi Studio com nove ações, todas mostrando o estado ao vivo na tecla:

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
| Próximo Turno | Começa o combate ou passa o turno | Quem está agindo e a rodada |

Para instalar:

```bash
npm run plugin:ulanzi
```

Depois reinicie o Ulanzi Studio: as ações aparecem na categoria **Mestrônomo**. Com o Mestrônomo fechado, as teclas mostram "Abra o Mestrônomo".

## Aviso sobre Spotify e YouTube

A captura e o player funcionam, mas retransmitir o Spotify ou o YouTube para outras pessoas vai contra os termos de uso dele. Para uso entre amigos o risco é baixo; se um dia quiser distribuir o Mestrônomo, prefira arquivos locais ou trilhas com licença livre.

## Licença

MIT. Veja [LICENSE](LICENSE).
