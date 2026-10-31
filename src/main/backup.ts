import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

// Backup: um .zip com a configuração (cenas, soundboard, volumes...) e, se pedido, as pastas
// de arquivos. Usa o tar.exe do próprio Windows, que grava direto no disco — uma pasta de
// músicas de vários GB não precisa caber na memória. O token do bot nunca entra no backup.

const execFileAsync = promisify(execFile);
const TAR = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe');
/** Pastas de DATA_DIR que vão no backup quando os arquivos são incluídos. */
export const DATA_FOLDERS = ['sons', 'ambientes', 'musicas', 'tabelas'];
const FORMAT = 1;

interface Manifest {
  formato: number;
  criadoEm: string;
  arquivos: boolean;
}

interface Paths {
  dataDir: string;
  configFile: string;
}

export async function exportBackup(target: string, { dataDir, configFile }: Paths, includeFiles: boolean) {
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'mestronomo-backup-'));
  try {
    const manifest: Manifest = { formato: FORMAT, criadoEm: new Date().toISOString(), arquivos: includeFiles };
    fs.writeFileSync(path.join(staging, 'manifest.json'), JSON.stringify(manifest, null, 2));
    fs.copyFileSync(configFile, path.join(staging, 'config.json'));
    const args = ['-a', '-c', '--options', 'zip:hdrcharset=UTF-8', '-f', target, '-C', staging, 'manifest.json', 'config.json'];
    if (includeFiles) {
      const folders = DATA_FOLDERS.filter((f) => fs.existsSync(path.join(dataDir, f)));
      if (folders.length) args.push('-C', dataDir, ...folders);
    }
    fs.rmSync(target, { force: true });
    await execFileAsync(TAR, args, { windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
    return fs.statSync(target).size;
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

/**
 * Aplica um backup: troca o config.json (mantendo o que só vale neste PC) e copia as pastas
 * de arquivos por cima das atuais. Quem chama reinicia o app depois.
 */
export async function importBackup(file: string, { dataDir, configFile }: Paths) {
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'mestronomo-import-'));
  try {
    try {
      await execFileAsync(TAR, ['-x', '-f', file, '-C', staging], { windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
    } catch {
      throw new Error('Esse arquivo não é um backup do Mestrônomo, ou está corrompido.');
    }
    const manifestFile = path.join(staging, 'manifest.json');
    if (!fs.existsSync(manifestFile)) throw new Error('Esse arquivo não é um backup do Mestrônomo.');
    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8')) as Manifest;
    if (manifest.formato > FORMAT) throw new Error('Esse backup é de uma versão mais nova do Mestrônomo. Atualize o app.');

    const imported = JSON.parse(fs.readFileSync(path.join(staging, 'config.json'), 'utf8'));
    let current: Record<string, unknown> = {};
    try {
      current = JSON.parse(fs.readFileSync(configFile, 'utf8'));
    } catch {}
    // O dispositivo de saída do fone é deste PC; o do backup provavelmente não existe aqui.
    imported.monitorDevice = current.monitorDevice;
    fs.mkdirSync(path.dirname(configFile), { recursive: true });
    fs.writeFileSync(configFile, JSON.stringify(imported, null, 2));

    let pastas = 0;
    for (const folder of DATA_FOLDERS) {
      const from = path.join(staging, folder);
      if (!fs.existsSync(from)) continue;
      fs.cpSync(from, path.join(dataDir, folder), { recursive: true, force: true });
      pastas++;
    }
    return { arquivos: manifest.arquivos, pastas };
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}
