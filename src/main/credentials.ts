import { app, safeStorage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

// Token do bot e ID do mestre. Configurados pela tela "Configurar bot" e guardados com o
// safeStorage (criptografia do Windows atrelada ao seu usuário). Variáveis de ambiente / .env
// têm prioridade, para o fluxo de desenvolvimento continuar igual.

export interface Credentials {
  token: string;
  /** Vazio: o dono da aplicação no Discord é o mestre. */
  ownerId: string;
}

interface Stored {
  token?: string; // base64 do token criptografado
  ownerId?: string;
}

const file = () => path.join(app.getPath('userData'), 'discord.json');

function readStored(): Stored {
  try {
    return JSON.parse(fs.readFileSync(file(), 'utf8'));
  } catch {
    return {};
  }
}

export function loadCredentials(): Credentials | undefined {
  const { DISCORD_TOKEN, DISCORD_OWNER_ID } = process.env;
  if (DISCORD_TOKEN) return { token: DISCORD_TOKEN, ownerId: DISCORD_OWNER_ID ?? '' };
  const stored = readStored();
  if (!stored.token || !safeStorage.isEncryptionAvailable()) return undefined;
  try {
    return { token: safeStorage.decryptString(Buffer.from(stored.token, 'base64')), ownerId: stored.ownerId ?? '' };
  } catch {
    return undefined;
  }
}

/** Token vazio mantém o já salvo (a tela nunca recebe o token de volta). */
export function saveCredentials(token: string, ownerId: string) {
  const stored = readStored();
  if (token) stored.token = safeStorage.encryptString(token.trim()).toString('base64');
  stored.ownerId = ownerId.trim();
  fs.writeFileSync(file(), JSON.stringify(stored, null, 2));
}

/** O que a tela de configuração pode saber: se há token salvo e de onde ele vem, nunca o valor. */
export function credentialsInfo() {
  const fromEnv = Boolean(process.env.DISCORD_TOKEN);
  const stored = readStored();
  return { fromEnv, hasToken: fromEnv || Boolean(stored.token), ownerId: fromEnv ? process.env.DISCORD_OWNER_ID : stored.ownerId ?? '' };
}
