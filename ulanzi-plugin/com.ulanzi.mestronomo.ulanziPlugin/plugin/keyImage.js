import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { COLORS, GLYPHS } from './glyphs.js';

// O Ulanzi Studio não desenha o `textData` de forma confiável, então o texto vai
// dentro de um SVG gravado em disco e aplicado como ícone por caminho (mesma técnica do SoundHop).

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RUNTIME_DIR = 'runtime-icons';
const SIZE = 144;
const MAX_CHARS = 14;

const slots = new Map();

function escapeXml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
}

function ellipsize(s) {
  return s.length > MAX_CHARS ? s.slice(0, MAX_CHARS - 1).trimEnd() + '…' : s;
}

/** Quebra em no máximo duas linhas, de preferência em espaços. */
export function wrapText(text) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (clean.length <= MAX_CHARS) return clean ? [clean] : [];
  let cut = -1;
  for (let i = Math.min(MAX_CHARS, clean.length - 1); i > 2; i--) {
    if (/[\s(\-_/]/.test(clean[i])) {
      cut = i;
      break;
    }
  }
  if (cut < 0) cut = MAX_CHARS;
  return [clean.slice(0, cut).trim(), ellipsize(clean.slice(cut).trim())].filter(Boolean);
}

/**
 * face: { glyph, text?, color?, background?, badge? }
 * `badge` é um texto curto no canto superior (ex.: "PRÉVIA", "80%").
 */
export function renderSvg({ glyph, text, color = COLORS.gold, background = COLORS.background, badge }) {
  const lines = wrapText(text);
  const box = lines.length === 0 ? { x: 24, y: 24, s: 96 } : lines.length === 1 ? { x: 36, y: 14, s: 72 } : { x: 42, y: 8, s: 60 };
  const fontSize = lines.length > 1 ? 16 : 18;
  const firstY = lines.length > 1 ? 100 : 118;
  const textSvg = lines
    .map(
      (line, i) =>
        `<text x="72" y="${firstY + i * 19}" text-anchor="middle" fill="${COLORS.text}" ` +
        `font-family="Segoe UI,sans-serif" font-size="${fontSize}" font-weight="600">${escapeXml(line)}</text>`,
    )
    .join('');
  const badgeWidth = 14 + String(badge || '').length * 9;
  const badgeSvg = badge
    ? `<rect x="${138 - badgeWidth}" y="6" width="${badgeWidth}" height="22" rx="6" fill="${COLORS.gold}"/>` +
      `<text x="${138 - badgeWidth / 2}" y="22" text-anchor="middle" fill="${COLORS.background}" font-family="Segoe UI,sans-serif" font-size="13" font-weight="700">${escapeXml(badge)}</text>`
    : '';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">` +
    `<rect width="${SIZE}" height="${SIZE}" fill="${background}"/>` +
    `<g transform="translate(${box.x} ${box.y}) scale(${box.s / 100})">${GLYPHS[glyph](color)}</g>` +
    textSvg +
    badgeSvg +
    `</svg>`
  );
}

/** Grava a imagem da tecla e devolve o caminho relativo ao plugin. Alterna entre dois arquivos para o host não usar cache velho. */
export function writeKeyImage(context, face) {
  const dir = path.join(PLUGIN_ROOT, RUNTIME_DIR);
  fs.mkdirSync(dir, { recursive: true });
  const id = crypto.createHash('sha1').update(context).digest('hex').slice(0, 12);
  const slot = (slots.get(context) ?? 1) ^ 1;
  slots.set(context, slot);
  const file = `${id}-${slot}.svg`;
  fs.writeFileSync(path.join(dir, file), renderSvg(face), 'utf8');
  return `./${RUNTIME_DIR}/${file}`;
}

export function clearKeyImages(context) {
  const id = crypto.createHash('sha1').update(context).digest('hex').slice(0, 12);
  for (const slot of [0, 1]) fs.rmSync(path.join(PLUGIN_ROOT, RUNTIME_DIR, `${id}-${slot}.svg`), { force: true });
  slots.delete(context);
}

export function clearAllKeyImages() {
  fs.rmSync(path.join(PLUGIN_ROOT, RUNTIME_DIR), { recursive: true, force: true });
}
