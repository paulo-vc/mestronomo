// Instala o plugin do Mestrônomo no Ulanzi Studio: instala as dependências e copia a pasta
// para %APPDATA%\Ulanzi\UlanziDeck\Plugins. Depois é só reiniciar o Ulanzi Studio.
const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const NAME = 'com.ulanzi.mestronomo.ulanziPlugin';
const SOURCE = path.join(__dirname, '..', 'ulanzi-plugin', NAME);
const PLUGINS = path.join(process.env.APPDATA, 'Ulanzi', 'UlanziDeck', 'Plugins');
const TARGET = path.join(PLUGINS, NAME);

if (!fs.existsSync(PLUGINS)) {
  console.error(`Não achei a pasta de plugins do Ulanzi Studio em ${PLUGINS}. O Ulanzi Studio está instalado?`);
  process.exit(1);
}

execSync('npm install --omit=dev --no-audit --no-fund', { cwd: SOURCE, stdio: 'inherit' });
fs.rmSync(TARGET, { recursive: true, force: true });
fs.cpSync(SOURCE, TARGET, { recursive: true, filter: (src) => !src.includes('runtime-icons') });
console.log(`\nPlugin instalado em ${TARGET}`);
console.log('Reinicie o Ulanzi Studio para ele aparecer na lista de ações (categoria "Mestrônomo").');
