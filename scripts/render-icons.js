// Gera os PNGs e o .ico a partir dos SVGs de assets/. Rode com: npm run icons
// Usa o próprio Electron (Chromium) para rasterizar, então não precisa de nenhuma dependência extra.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ASSETS = path.join(__dirname, '..', 'assets');
const ICON_SIZES = [16, 24, 32, 48, 64, 128, 256];

let win;

/** Renderiza um SVG de assets/ em PNG no tamanho pedido (desenha grande e reduz, para bordas suaves). */
async function render(svgFile, width, height) {
  const scale = Math.max(1, Math.ceil(512 / Math.max(width, height)));
  const [w, h] = [width * scale, height * scale];
  const svg = fs.readFileSync(path.join(ASSETS, svgFile), 'utf8');
  const html = path.join(os.tmpdir(), 'mestronomo-render.html');
  fs.writeFileSync(
    html,
    `<html><head><meta charset="utf-8"></head><body style="margin:0;background:transparent;overflow:hidden">
      <div style="width:${w}px;height:${h}px">${svg.replace('<svg ', '<svg width="100%" height="100%" ')}</div>
    </body></html>`,
  );
  win.setContentSize(w, h);
  await win.loadFile(html);
  await new Promise((r) => setTimeout(r, 200));
  const image = await win.webContents.capturePage({ x: 0, y: 0, width: w, height: h });
  return image.resize({ width, height, quality: 'best' }).toPNG();
}

/** ICO com entradas PNG (aceito pelo Windows desde o Vista). */
function buildIco(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  const entries = [];
  let offset = 6 + 16 * pngs.length;
  for (const { size, data } of pngs) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    offset += data.length;
  }
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.data)]);
}

app.whenReady().then(async () => {
  win = new BrowserWindow({
    width: 512,
    height: 512,
    show: false,
    frame: false,
    transparent: true,
    useContentSize: true,
    enableLargerThanScreen: true,
    webPreferences: { offscreen: true },
  });
  const pngs = [];
  for (const size of ICON_SIZES) {
    // Até 32 px o desenho detalhado vira borrão; usamos a versão simplificada.
    pngs.push({ size, data: await render(size <= 32 ? 'icon-small.svg' : 'icon.svg', size, size) });
  }
  fs.writeFileSync(path.join(ASSETS, 'icon.ico'), buildIco(pngs));
  fs.writeFileSync(path.join(ASSETS, 'icon.png'), await render('icon.svg', 512, 512));
  fs.writeFileSync(path.join(ASSETS, 'social.png'), await render('social.svg', 1280, 640));
  win.destroy();
  console.log('Gerados: icon.ico, icon.png, social.png');
  app.quit();
});
