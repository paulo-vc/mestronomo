# Identidade visual do Mestrônomo

## Conceito

**Mestre + metrônomo.** O ícone é um metrônomo em que o peso do pêndulo é um **d20**: quem dita o ritmo da mesa é o mestre. O dourado lembra latão de instrumento antigo e moedas de taverna; o roxo-noite é a mesa à luz de velas.

Slogan: **O ritmo da sua mesa.**

## Arquivos

| Arquivo | Uso |
| --- | --- |
| `assets/icon.svg` | Ícone principal (48 px para cima) |
| `assets/icon-small.svg` | Versão simplificada para 16–32 px (sem marcações, d20 em silhueta) |
| `assets/icon.ico` / `icon.png` | Janela, barra de tarefas e instalador (gerados) |
| `assets/logo.svg` | Logo horizontal: ícone + nome + slogan |
| `assets/social.svg` / `social.png` | Imagem de compartilhamento do GitHub (1280×640) |

Os PNGs e o `.ico` são gerados a partir dos SVGs com `npm run icons`. Edite sempre o SVG.

## Cores

| Nome | Hex | Uso |
| --- | --- | --- |
| Noite | `#15121c` | Fundo do app |
| Superfície | `#1f1a29` | Cartões |
| Superfície 2 | `#2a2337` | Botões, campos |
| Borda | `#3a3149` | Divisórias |
| Ouro | `#d9a441` | Cor de destaque, nome, botões principais |
| Ouro claro | `#f0c262` | Brilho do gradiente do ícone |
| Ouro escuro | `#c78f2e` | Base do gradiente do ícone |
| Pergaminho | `#ece6f5` | Texto principal, haste do pêndulo |
| Névoa | `#9d93ad` | Texto secundário |
| Tinta | `#1a1408` | Texto sobre ouro, linhas do d20 |

Estados: verde `#5fbf85` (conectado), âmbar `#e0b04a` (aguardando), vermelho `#d9605a` (erro / parar).

## Tipografia

- **Nome e títulos de destaque:** Constantia (serifada clássica do Windows), com Palatino Linotype e Georgia como alternativas. Peso bold.
- **Interface e texto corrido:** Segoe UI.
- **Slogan:** Segoe UI em caixa alta com espaçamento largo (`letter-spacing` ≈ 0,15 em).

## Uso do ícone

- Mantenha uma margem livre de pelo menos 1/8 da largura em volta.
- Não troque o d20 por outro dado nem mude as cores do ouro.
- Em fundos claros, use o ícone com o próprio quadrado escuro; não recorte o metrônomo sozinho.
