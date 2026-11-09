import { EventEmitter } from 'node:events';
import {
  Client,
  EmbedBuilder,
  GatewayIntentBits,
  MessageFlags,
  SlashCommandBuilder,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
  type Guild,
  type Message,
  type SendableChannels,
  type VoiceBasedChannel,
} from 'discord.js';
import {
  AudioPlayerStatus,
  NoSubscriberBehavior,
  StreamType,
  VoiceConnectionStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
  getVoiceConnection,
  joinVoiceChannel,
  type AudioPlayer,
} from '@discordjs/voice';
import type { Mixer } from './mixer';
import { formatCommand, formatRoll, roll, rollCommand, type RollResult } from './dice';

/** Rolar escrevendo no chat: "!d20+5", "!3#d20+5 ataque" (também "!r d20"). */
const PREFIXO_DADOS = '!';
/** Com o prefixo, só responde erro quando o texto parece mesmo dado (não atrapalha "!play" de outro bot). */
const PARECE_DADO = /^(\d|\(|d\d|d%|vantagem|desvantagem|adv\b|dis\b)/i;

/** Erro de login por pedir "Message Content Intent" sem ela estar ligada no Developer Portal. */
const intentNegada = (err: unknown) =>
  (err as { code?: string }).code === 'DisallowedIntents' || /disallowed intents|privileged intent/i.test(String((err as Error)?.message));

export type BotStatus =
  | { state: 'desligado'; motivo?: string }
  | { state: 'conectando' }
  | { state: 'aguardando'; bot: string }
  | { state: 'no-canal'; bot: string; canal: string; servidor: string };

const COMMANDS = [
  new SlashCommandBuilder().setName('entrar').setDescription('Mestrônomo entra no seu canal de voz'),
  new SlashCommandBuilder().setName('sair').setDescription('Mestrônomo sai do canal de voz'),
  new SlashCommandBuilder()
    .setName('r')
    .setDescription('Rola dados: d20+5, 3#d20+5, 4d6dl1, 3d6!, vantagem+3, d20+5>=15 (ou no chat: !d20+5)')
    .addStringOption((o) => o.setName('dados').setDescription('Expressão e rótulo opcional, ex.: 3#d20+5 ataque').setRequired(true))
    .addBooleanOption((o) => o.setName('secreto').setDescription('Só você vê o resultado')),
  new SlashCommandBuilder().setName('canal').setDescription('Usa este canal de texto para "tocando agora" e handouts'),
  new SlashCommandBuilder()
    .setName('iniciativa')
    .setDescription('Rola a sua iniciativa (1d20 + bônus) e entra na ordem de combate')
    .addIntegerOption((o) => o.setName('bonus').setDescription('Seu bônus de iniciativa, ex.: 3').setMinValue(-10).setMaxValue(30))
    .addIntegerOption((o) => o.setName('valor').setDescription('Já rolou? Informe o total direto').setMinValue(-10).setMaxValue(60)),
  new SlashCommandBuilder().setName('ordem').setDescription('Mostra a ordem de combate'),
  new SlashCommandBuilder()
    .setName('musica')
    .setDescription('Pede uma música ao mestre (link do YouTube)')
    .addStringOption((o) => o.setName('link').setDescription('Link do vídeo').setRequired(true)),
  new SlashCommandBuilder()
    .setName('som')
    .setDescription('Pede um efeito da soundboard ao mestre')
    .addStringOption((o) => o.setName('nome').setDescription('Nome do som').setRequired(true).setAutocomplete(true)),
  new SlashCommandBuilder().setName('resumo').setDescription('Posta o resumo da sessão (só o mestre)'),
].map((c) => c.toJSON());

export interface Player {
  id: string;
  nome: string;
}

/**
 * O que o bot pede ao resto do app. O bot só cuida do Discord; quem decide (tracker,
 * soundboard, fila de pedidos, resumo) é o main.
 */
export interface BotHooks {
  /** Entra (ou atualiza) o jogador na ordem de combate. */
  iniciativa(jogador: Player, total: number): void;
  /** Texto da ordem de combate, já formatado para o Discord. */
  ordem(): string;
  /** Pedido de música/som de um jogador; `true` se entrou na fila. Do mestre, toca direto. */
  pedido(tipo: 'musica' | 'som', jogador: Player, valor: string, doMestre: boolean): { ok: boolean; mensagem: string };
  /** Ids dos sons da soundboard, para o autocompletar de /som. */
  sons(): string[];
  rolagem(jogador: Player, resultado: RollResult): void;
  /** Texto do resumo da sessão (embed montado pelo bot). */
  resumo(): { titulo: string; linhas: string[] };
}

/** O que a mensagem "tocando agora" mostra. */
export interface NowPlaying {
  musica?: string;
  cena?: string;
  ambiente: string[];
}

const BRAND_COLOR = 0xd9a441;

/**
 * Bot do mestre. Só entra num canal de voz quando chamado: /entrar no Discord,
 * botão no app ou API local. Sai com /sair ou quando fica sozinho no canal.
 */
export class DiscordBot extends EventEmitter {
  status: BotStatus = { state: 'desligado' };

  /** Ler as mensagens do chat (para "!d20") exige "Message Content Intent" ligada no Developer Portal. */
  private lerMensagens = true;
  private client = DiscordBot.criarCliente(true);
  private player: AudioPlayer;
  private guildId: string | undefined;
  /**
   * Canal de texto de cada servidor (id do servidor → id do canal), escolhido com /canal.
   * As mensagens só vão para o servidor ativo — nunca para os outros em que o bot está.
   */
  textChannels: Record<string, string> = {};
  /** Canal único das versões antigas (antes de ser por servidor); convertido ao conectar. */
  legacyTextChannelId: string | undefined;
  /** Mensagem "tocando agora" de cada servidor, editada no lugar. */
  private nowPlayingMessages = new Map<string, Message>();
  private nowPlayingTimer: NodeJS.Timeout | undefined;

  constructor(
    private mixer: Mixer,
    private token: string,
    private ownerId: string,
    private hooks: BotHooks,
  ) {
    // ownerId vazio: descobrimos o dono da aplicação assim que o bot conecta.
    super();
    this.player = createAudioPlayer({
      // Toca mesmo sem ninguém ouvindo, e nunca desiste por falta de pacotes: silêncio é normal aqui.
      behaviors: { noSubscriber: NoSubscriberBehavior.Play, maxMissedFrames: Number.MAX_SAFE_INTEGER },
    });
    this.player.on('error', (err) => console.error('[player]', err));
    this.player.on(AudioPlayerStatus.Idle, () => this.playMixer());
    this.playMixer();
  }

  private static criarCliente(lerMensagens: boolean) {
    const intents = [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates];
    if (lerMensagens) intents.push(GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent);
    return new Client({ intents });
  }

  async start() {
    this.setStatus({ state: 'conectando' });
    this.ligarEventos();
    try {
      await this.client.login(this.token);
    } catch (err) {
      if (!this.lerMensagens || !intentNegada(err)) {
        this.setStatus({ state: 'desligado', motivo: `Falha no login: ${(err as Error).message}` });
        return;
      }
      // Sem "Message Content Intent" no Developer Portal: entra sem ler o chat; o /r continua valendo.
      this.lerMensagens = false;
      await this.client.destroy().catch(() => {});
      this.client = DiscordBot.criarCliente(false);
      this.ligarEventos();
      this.emit(
        'erro',
        'Para rolar dados escrevendo !d20 no chat, ligue "Message Content Intent" no Discord Developer Portal (seu app → aba Bot) e reinicie o Mestrônomo. O /r funciona sem isso.',
      );
      try {
        await this.client.login(this.token);
      } catch (err2) {
        this.setStatus({ state: 'desligado', motivo: `Falha no login: ${(err2 as Error).message}` });
      }
    }
  }

  private ligarEventos() {
    this.client.once('clientReady', async () => {
      if (!this.ownerId) {
        const app = await this.client.application!.fetch();
        this.ownerId = (app.owner && 'ownerId' in app.owner ? app.owner.ownerId : app.owner?.id) ?? '';
      }
      this.setStatus({ state: 'aguardando', bot: this.client.user!.tag });
      for (const guild of this.client.guilds.cache.values()) this.registerCommands(guild);
      await this.migrateLegacyChannel();
    });
    this.client.on('guildCreate', (guild) => this.registerCommands(guild));
    this.client.on('interactionCreate', (interaction) => {
      if (interaction.isChatInputCommand()) this.onCommand(interaction);
      else if (interaction.isAutocomplete()) this.onAutocomplete(interaction);
    });
    // Sai quando não sobra nenhuma pessoa (só bots) no canal.
    this.client.on('voiceStateUpdate', (oldState) => {
      const channel = oldState.guild.members.me?.voice.channel;
      if (oldState.guild.id === this.guildId && channel && channel.members.every((m) => m.user.bot)) this.leave();
    });
    if (this.lerMensagens) this.client.on('messageCreate', (message) => this.onMensagem(message).catch((err) => console.error('[dados]', err)));
  }

  /** "!d20+5", "!3#d20+5 ataque", "!r 2d6": rola e responde no próprio canal. */
  private async onMensagem(message: Message) {
    if (message.author.bot || !message.inGuild()) return;
    const texto = message.content.trim();
    if (!texto.startsWith(PREFIXO_DADOS)) return;
    const expressao = texto.slice(PREFIXO_DADOS.length).trim().replace(/^(r|roll|rolar)\s+/i, '');
    if (!expressao) return;
    const jogador: Player = { id: message.author.id, nome: message.member?.displayName ?? message.author.displayName };
    let conteudo: string;
    try {
      const comando = rollCommand(expressao);
      for (const r of comando.rolagens) this.hooks.rolagem(jogador, r);
      conteudo = `🎲 **${jogador.nome}** rolou ${formatCommand(comando)}`;
    } catch (err) {
      if (!PARECE_DADO.test(expressao)) return;
      conteudo = (err as Error).message;
    }
    // Responder exige "Ler histórico de mensagens"; bots convidados antes disso mandam no canal.
    await message
      .reply({ content: conteudo, allowedMentions: { repliedUser: false } })
      .catch(() => message.channel.send({ content: conteudo, allowedMentions: { parse: [] } }));
  }

  /** Entra no canal de voz em que o mestre está agora. */
  async joinOwner() {
    const channel = this.findOwnerChannel();
    if (!channel) {
      this.emit('erro', 'Entre num canal de voz primeiro; o bot vai para o canal em que você estiver.');
      return false;
    }
    return this.join(channel);
  }

  leave() {
    if (!this.guildId) return;
    getVoiceConnection(this.guildId)?.destroy();
    this.guildId = undefined;
    if (this.client.user) this.setStatus({ state: 'aguardando', bot: this.client.user.tag });
  }

  async destroy() {
    this.leave();
    await this.client.destroy();
  }

  private async registerCommands(guild: Guild) {
    try {
      // Comandos por servidor aparecem na hora (os globais podem levar até 1 h).
      await guild.commands.set(COMMANDS);
    } catch {
      this.emit('erro', `Não consegui registrar /entrar em ${guild.name}. Convide o bot de novo com o escopo applications.commands.`);
    }
  }

  private async onCommand(interaction: ChatInputCommandInteraction) {
    const reply = (content: string) => interaction.reply({ content, flags: MessageFlags.Ephemeral });
    // Dados, iniciativa, ordem e pedidos são para todo mundo; o resto é só do mestre.
    const jogador = this.jogadorDe(interaction);
    const doMestre = interaction.user.id === this.ownerId;
    switch (interaction.commandName) {
      case 'r':
        return this.onRoll(interaction);
      case 'iniciativa': {
        const valor = interaction.options.getInteger('valor');
        const bonus = interaction.options.getInteger('bonus') ?? 0;
        const r = valor === null ? roll(`1d20${bonus < 0 ? '' : '+'}${bonus}`) : undefined;
        const total = valor ?? r!.total;
        this.hooks.iniciativa(jogador, total);
        if (r) this.hooks.rolagem(jogador, r);
        return interaction.reply(`⚔️ **${jogador.nome}** entrou na ordem com iniciativa **${total}**${r ? ` (${formatRoll(r)})` : ''}`);
      }
      case 'ordem':
        return interaction.reply(this.hooks.ordem());
      case 'musica':
      case 'som': {
        const valor = interaction.options.getString(interaction.commandName === 'musica' ? 'link' : 'nome', true);
        const r = this.hooks.pedido(interaction.commandName, jogador, valor, doMestre);
        return interaction.reply({ content: r.mensagem, flags: r.ok && !doMestre ? undefined : MessageFlags.Ephemeral });
      }
    }
    if (interaction.user.id !== this.ownerId) return reply('Só o mestre pode chamar o Mestrônomo.');
    if (!interaction.guild) return reply('Use este comando dentro de um servidor.');

    if (interaction.commandName === 'resumo') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      try {
        // Digitado no Discord: posta no próprio servidor, não no "ativo".
        await this.postSummary(interaction.guild.id);
        return interaction.editReply('Resumo postado no canal.');
      } catch (err) {
        return interaction.editReply((err as Error).message);
      }
    }

    if (interaction.commandName === 'canal') {
      this.textChannels[interaction.guild.id] = interaction.channelId;
      this.nowPlayingMessages.delete(interaction.guild.id);
      this.emit('canais', { ...this.textChannels });
      return reply(`Pronto: neste servidor vou usar este canal para "tocando agora" e handouts. Mensagens automáticas só saem enquanto eu estiver numa call daqui.`);
    }

    if (interaction.commandName === 'sair') {
      this.leave();
      return reply('Saí do canal de voz.');
    }
    const channel = interaction.guild.voiceStates.cache.get(interaction.user.id)?.channel;
    if (!channel) return reply('Entre num canal de voz primeiro.');
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const ok = await this.join(channel);
    await interaction.editReply(ok ? `Entrei em **${channel.name}**.` : `Não consegui entrar em ${channel.name}. Tenho permissão de Conectar e Falar?`);
  }

  private jogadorDe(interaction: ChatInputCommandInteraction): Player {
    const nome = interaction.member && 'displayName' in interaction.member ? interaction.member.displayName : interaction.user.displayName;
    return { id: interaction.user.id, nome };
  }

  private async onAutocomplete(interaction: AutocompleteInteraction) {
    const digitado = interaction.options.getFocused().toLowerCase();
    const sons = this.hooks.sons().filter((s) => s.toLowerCase().includes(digitado)).slice(0, 25);
    await interaction.respond(sons.map((s) => ({ name: s.slice(0, 100), value: s.slice(0, 100) }))).catch(() => {});
  }

  private async onRoll(interaction: ChatInputCommandInteraction) {
    const secreto = interaction.options.getBoolean('secreto') ?? false;
    try {
      const comando = rollCommand(interaction.options.getString('dados', true));
      const jogador = this.jogadorDe(interaction);
      if (!secreto) for (const r of comando.rolagens) this.hooks.rolagem(jogador, r);
      await interaction.reply({
        content: `🎲 **${jogador.nome}** rolou ${formatCommand(comando)}${secreto ? '  *(secreto)*' : ''}`,
        flags: secreto ? MessageFlags.Ephemeral : undefined,
      });
    } catch (err) {
      await interaction.reply({ content: (err as Error).message, flags: MessageFlags.Ephemeral });
    }
  }

  /**
   * Atualiza a mensagem "tocando agora" no canal escolhido com /canal. Edita sempre a mesma
   * mensagem, e espera 2 s entre mudanças para não esbarrar no limite de edições do Discord.
   */
  updateNowPlaying(info: NowPlaying) {
    clearTimeout(this.nowPlayingTimer);
    this.nowPlayingTimer = setTimeout(() => this.postNowPlaying(info).catch((err) => console.error('[tocando agora]', err)), 2000);
  }

  private async postNowPlaying(info: NowPlaying) {
    // Automática: só no servidor em cuja call o bot está.
    const guildId = this.guildId;
    const { channel } = await this.textChannel(guildId);
    if (!guildId || !channel) return;
    const embed = new EmbedBuilder()
      .setColor(BRAND_COLOR)
      .setAuthor({ name: 'Mestrônomo · tocando agora' })
      .setTitle(info.musica ?? 'Sem música')
      .setTimestamp();
    if (info.cena) embed.addFields({ name: 'Cena', value: info.cena, inline: true });
    if (info.ambiente.length) embed.addFields({ name: 'Ambiente', value: info.ambiente.join(', '), inline: true });
    const anterior = this.nowPlayingMessages.get(guildId);
    if (anterior && anterior.channelId === channel.id) {
      try {
        await anterior.edit({ embeds: [embed] });
        return;
      } catch {
        // A mensagem foi apagada: manda uma nova.
      }
    }
    this.nowPlayingMessages.set(guildId, await channel.send({ embeds: [embed] }));
  }

  /** Posta o resumo da sessão no canal do /canal do servidor ativo (ou do servidor indicado). */
  async postSummary(guildId = this.activeGuildId()) {
    const channel = await this.requireTextChannel(guildId);
    const { titulo, linhas } = this.hooks.resumo();
    // Embeds aceitam até 4096 caracteres na descrição.
    let descricao = '';
    for (const linha of linhas) {
      if (descricao.length + linha.length + 1 > 4000) break;
      descricao += `${linha}\n`;
    }
    const embed = new EmbedBuilder().setColor(BRAND_COLOR).setTitle(titulo).setDescription(descricao || 'Nada registrado nesta sessão.').setTimestamp();
    await channel.send({ embeds: [embed] });
  }

  /**
   * Manda um texto no canal do /canal. Automática (turnos, "tocando a pedido"): só se o bot estiver
   * numa call, e no servidor dela; senão é descartada em silêncio. Manual (tabelas): servidor ativo.
   */
  async sendMessage(content: string, automatica = false) {
    if (automatica) {
      const { channel } = await this.textChannel(this.guildId);
      if (channel) await channel.send({ content });
      return;
    }
    const channel = await this.requireTextChannel(this.activeGuildId());
    await channel.send({ content });
  }

  /** Manda uma imagem (mapa, retrato, carta...) para o canal do /canal do servidor ativo. */
  async sendHandout(file: string, caption?: string) {
    const channel = await this.requireTextChannel(this.activeGuildId());
    await channel.send({ content: caption || undefined, files: [file] });
  }

  /**
   * Servidor ativo: o da call em que o bot está; sem bot em call, o da call em que o mestre está.
   * Nunca "qualquer servidor" — é isso que evita mandar mensagem onde ninguém está jogando.
   */
  activeGuildId(): string | undefined {
    return this.guildId ?? this.findOwnerChannel()?.guild.id;
  }

  private async textChannel(guildId: string | undefined): Promise<{ channel?: SendableChannels; motivo?: string }> {
    if (!this.client.isReady()) return { motivo: 'O bot ainda está conectando ao Discord.' };
    if (!guildId) return { motivo: 'Chame o bot para uma call (ou entre numa) para eu saber em qual servidor mandar.' };
    const guild = this.client.guilds.cache.get(guildId);
    const doServidor = guild ? `de ${guild.name}` : 'deste servidor';
    const channelId = this.textChannels[guildId];
    if (!channelId) return { motivo: `Use /canal no canal de texto ${doServidor} para eu saber onde mandar.` };
    const channel = await this.client.channels.fetch(channelId).catch(() => null);
    // Confere que o canal é mesmo deste servidor, por segurança.
    if (!channel?.isSendable() || !('guildId' in channel) || channel.guildId !== guildId) {
      return { motivo: `O canal escolhido ${doServidor} não existe mais. Use /canal de novo.` };
    }
    return { channel };
  }

  private async requireTextChannel(guildId: string | undefined) {
    const { channel, motivo } = await this.textChannel(guildId);
    if (!channel) throw new Error(motivo);
    return channel;
  }

  /** Converte o canal único das versões antigas para o formato por servidor. */
  private async migrateLegacyChannel() {
    if (!this.legacyTextChannelId) return;
    const channel = await this.client.channels.fetch(this.legacyTextChannelId).catch(() => null);
    if (channel && 'guildId' in channel && channel.guildId && !this.textChannels[channel.guildId]) {
      this.textChannels[channel.guildId] = channel.id;
    }
    this.legacyTextChannelId = undefined;
    this.emit('canais', { ...this.textChannels });
  }

  private playMixer() {
    const resource = createAudioResource(this.mixer.createOpusStream(), { inputType: StreamType.Opus });
    this.player.play(resource);
  }

  private findOwnerChannel(): VoiceBasedChannel | undefined {
    for (const guild of this.client.guilds.cache.values()) {
      const channel = guild.voiceStates.cache.get(this.ownerId)?.channel;
      if (channel) return channel;
    }
  }

  private async join(channel: VoiceBasedChannel) {
    if (this.guildId && this.guildId !== channel.guild.id) this.leave();
    this.guildId = channel.guild.id;
    const connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: channel.guild.id,
      adapterCreator: channel.guild.voiceAdapterCreator,
      selfDeaf: true,
    });
    connection.subscribe(this.player);
    try {
      await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
      this.setStatus({ state: 'no-canal', bot: this.client.user!.tag, canal: channel.name, servidor: channel.guild.name });
      return true;
    } catch {
      connection.destroy();
      this.guildId = undefined;
      this.setStatus({ state: 'aguardando', bot: this.client.user!.tag });
      this.emit('erro', `Não consegui entrar em ${channel.name}. O bot tem permissão de Conectar e Falar?`);
      return false;
    }
  }

  private setStatus(status: BotStatus) {
    this.status = status;
    this.emit('status', status);
  }
}
