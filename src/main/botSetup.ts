// Ajuda a configurar o próprio bot: verifica o token, descobre o dono e monta o link de convite.

/** View Channels, Send Messages, Embed Links, Attach Files, Connect e Speak — só o que o Mestrônomo usa. */
const PERMISSIONS = 1024 + 2048 + 16384 + 32768 + 1048576 + 2097152;

export const DEVELOPER_PORTAL = 'https://discord.com/developers/applications';

export interface BotCheck {
  ok: boolean;
  erro?: string;
  bot?: string;
  /** Dono da aplicação no Discord: vira o mestre quando o ID não é informado. */
  ownerId?: string;
  dono?: string;
  convite?: string;
}

/** O ID do bot é a primeira parte do token, em base64. */
export function botIdFromToken(token: string) {
  try {
    const id = Buffer.from(token.trim().split('.')[0], 'base64').toString('utf8');
    return /^\d{15,25}$/.test(id) ? id : undefined;
  } catch {
    return undefined;
  }
}

export function inviteUrl(botId: string) {
  return `https://discord.com/oauth2/authorize?client_id=${botId}&scope=bot+applications.commands&permissions=${PERMISSIONS}`;
}

export async function checkToken(token: string): Promise<BotCheck> {
  const id = botIdFromToken(token);
  if (!id) return { ok: false, erro: 'Isso não parece um token de bot. Copie em Bot → Reset Token.' };
  const headers = { Authorization: `Bot ${token.trim()}` };
  try {
    const res = await fetch('https://discord.com/api/v10/oauth2/applications/@me', { headers });
    if (res.status === 401) return { ok: false, erro: 'Token inválido ou revogado. Gere um novo em Bot → Reset Token.' };
    if (!res.ok) return { ok: false, erro: `O Discord respondeu ${res.status}. Tente de novo em instantes.` };
    const app = (await res.json()) as { name: string; owner?: { id: string; username: string }; team?: { owner_user_id: string; name: string } };
    const ownerId = app.team?.owner_user_id ?? app.owner?.id;
    return {
      ok: true,
      bot: app.name,
      ownerId,
      dono: app.team ? `equipe ${app.team.name}` : app.owner?.username,
      convite: inviteUrl(id),
    };
  } catch {
    return { ok: false, erro: 'Não consegui falar com o Discord. Verifique a internet.' };
  }
}
