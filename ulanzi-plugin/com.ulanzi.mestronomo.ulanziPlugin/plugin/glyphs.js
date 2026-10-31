// Glifos das teclas, desenhados numa caixa de 100×100. `c` é a cor principal.
// Os mesmos desenhos geram os PNGs do manifest (scripts/render-plugin-icons.js) e as faces dinâmicas.

export const COLORS = {
  background: '#15121c',
  backgroundOn: '#2a2010',
  backgroundOff: '#1b1820',
  gold: '#d9a441',
  text: '#ece6f5',
  muted: '#6b6380',
};

const speaker = (c) => `<path d="M14 38 H32 L54 20 V80 L32 62 H14 Z" fill="${c}"/>`;

export const GLYPHS = {
  som: (c) => `${speaker(c)}
    <path d="M66 34 Q78 50 66 66 M76 24 Q96 50 76 76" fill="none" stroke="${c}" stroke-width="7" stroke-linecap="round"/>`,

  previa: (c) => `<path d="M18 62 V52 A32 32 0 0 1 82 52 V62" fill="none" stroke="${c}" stroke-width="8" stroke-linecap="round"/>
    <rect x="12" y="56" width="20" height="30" rx="7" fill="${c}"/>
    <rect x="68" y="56" width="20" height="30" rx="7" fill="${c}"/>`,

  play: (c) => `<path d="M32 18 L82 50 L32 82 Z" fill="${c}" stroke="${c}" stroke-width="6" stroke-linejoin="round"/>`,

  pause: (c) => `<rect x="24" y="18" width="18" height="64" rx="4" fill="${c}"/><rect x="58" y="18" width="18" height="64" rx="4" fill="${c}"/>`,

  proxima: (c) => `<path d="M20 20 L62 50 L20 80 Z" fill="${c}" stroke="${c}" stroke-width="6" stroke-linejoin="round"/>
    <rect x="68" y="18" width="14" height="64" rx="4" fill="${c}"/>`,

  pararEfeitos: (c) => `${speaker(c)}
    <path d="M66 36 L90 64 M90 36 L66 64" stroke="${c}" stroke-width="8" stroke-linecap="round"/>`,

  // O d20 da marca: o bot do Mestrônomo.
  bot: (c) => `<g transform="translate(50 50)">
      <polygon points="0,-42 36.4,-21 36.4,21 0,42 -36.4,21 -36.4,-21" fill="${c}"/>
      <g stroke="${COLORS.background}" stroke-width="4" stroke-linejoin="round" stroke-linecap="round" fill="none">
        <polygon points="0,-23 19.9,11.5 -19.9,11.5"/>
        <path d="M0,-23 L-36.4,-21 M0,-23 L36.4,-21 M0,-23 L0,-42 M19.9,11.5 L36.4,-21 M19.9,11.5 L0,42
                 M19.9,11.5 L36.4,21 M-19.9,11.5 L0,42 M-19.9,11.5 L-36.4,-21 M-19.9,11.5 L-36.4,21"/>
      </g>
    </g>`,

  volumeMais: (c) => `${speaker(c)}
    <path d="M78 34 V66 M62 50 H94" stroke="${c}" stroke-width="8" stroke-linecap="round"/>`,

  volumeMenos: (c) => `${speaker(c)}
    <path d="M62 50 H94" stroke="${c}" stroke-width="8" stroke-linecap="round"/>`,

  captura: (c) => `<rect x="10" y="18" width="80" height="58" rx="8" fill="none" stroke="${c}" stroke-width="7"/>
    <path d="M10 32 H90" stroke="${c}" stroke-width="6"/>
    <path d="M24 60 Q32 44 40 60 T56 60 T72 60" fill="none" stroke="${c}" stroke-width="6" stroke-linecap="round"/>
    <path d="M36 88 H64" stroke="${c}" stroke-width="7" stroke-linecap="round"/>`,

  // Claquete: a cena.
  cena: (c) => `<path d="M12 40 H88 V82 Q88 88 82 88 H18 Q12 88 12 82 Z" fill="${c}"/>
    <path d="M12 34 L84 16 L88 30 L16 48 Z" fill="${c}"/>
    <path d="M30 29 L40 41 M50 24 L60 36 M70 19 L80 31" stroke="${COLORS.background}" stroke-width="6"/>`,

  // Espadas cruzadas: o turno do combate.
  turno: (c) => `<path d="M18 14 L72 68 M82 14 L28 68" stroke="${c}" stroke-width="9" stroke-linecap="round"/>
    <path d="M60 64 L76 80 M40 64 L24 80" stroke="${c}" stroke-width="9" stroke-linecap="round"/>
    <circle cx="80" cy="84" r="7" fill="${c}"/><circle cx="20" cy="84" r="7" fill="${c}"/>`,

  aviso: (c) => `<path d="M50 12 L92 86 H8 Z" fill="none" stroke="${c}" stroke-width="7" stroke-linejoin="round"/>
    <path d="M50 38 V60" stroke="${c}" stroke-width="8" stroke-linecap="round"/><circle cx="50" cy="73" r="5" fill="${c}"/>`,
};

/** SVG de um glifo centralizado num quadrado com fundo, para ícones fixos (sem texto). */
export function iconSvg(name, size = 144, color = COLORS.gold, background = COLORS.background) {
  const pad = size * 0.18;
  const s = size - pad * 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
    `<rect width="${size}" height="${size}" fill="${background}"/>` +
    `<g transform="translate(${pad} ${pad}) scale(${s / 100})">${GLYPHS[name](color)}</g></svg>`;
}
