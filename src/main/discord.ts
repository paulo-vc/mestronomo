import { EventEmitter } from 'node:events';
import {
  Client,
  GatewayIntentBits,
  MessageFlags,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type Guild,
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

export type BotStatus =
  | { state: 'desligado'; motivo?: string }
  | { state: 'conectando' }
  | { state: 'aguardando'; bot: string }
  | { state: 'no-canal'; bot: string; canal: string; servidor: string };

const COMMANDS = [
  new SlashCommandBuilder().setName('entrar').setDescription('Mestrônomo entra no seu canal de voz'),
  new SlashCommandBuilder().setName('sair').setDescription('Mestrônomo sai do canal de voz'),
].map((c) => c.toJSON());

/**
 * Bot do mestre. Só entra num canal de voz quando chamado: /entrar no Discord,
 * botão no app ou API local. Sai com /sair ou quando fica sozinho no canal.
 */
export class DiscordBot extends EventEmitter {
  status: BotStatus = { state: 'desligado' };

  private client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });
  private player: AudioPlayer;
  private guildId: string | undefined;

  constructor(private mixer: Mixer, private token: string, private ownerId: string) {
    super();
    this.player = createAudioPlayer({
      // Toca mesmo sem ninguém ouvindo, e nunca desiste por falta de pacotes: silêncio é normal aqui.
      behaviors: { noSubscriber: NoSubscriberBehavior.Play, maxMissedFrames: Number.MAX_SAFE_INTEGER },
    });
    this.player.on('error', (err) => console.error('[player]', err));
    this.player.on(AudioPlayerStatus.Idle, () => this.playMixer());
    this.playMixer();
  }

  async start() {
    this.setStatus({ state: 'conectando' });
    this.client.once('clientReady', () => {
      this.setStatus({ state: 'aguardando', bot: this.client.user!.tag });
      for (const guild of this.client.guilds.cache.values()) this.registerCommands(guild);
    });
    this.client.on('guildCreate', (guild) => this.registerCommands(guild));
    this.client.on('interactionCreate', (interaction) => {
      if (interaction.isChatInputCommand()) this.onCommand(interaction);
    });
    // Sai quando não sobra nenhuma pessoa (só bots) no canal.
    this.client.on('voiceStateUpdate', (oldState) => {
      const channel = oldState.guild.members.me?.voice.channel;
      if (oldState.guild.id === this.guildId && channel && channel.members.every((m) => m.user.bot)) this.leave();
    });
    try {
      await this.client.login(this.token);
    } catch (err) {
      this.setStatus({ state: 'desligado', motivo: `Falha no login: ${(err as Error).message}` });
    }
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
    if (interaction.user.id !== this.ownerId) return reply('Só o mestre pode chamar o Mestrônomo.');
    if (!interaction.guild) return reply('Use este comando dentro de um servidor.');

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
