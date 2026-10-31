import { EventEmitter } from 'node:events';
import { Client, GatewayIntentBits, type VoiceBasedChannel } from 'discord.js';
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

/**
 * Bot que segue o mestre: entra no canal de voz em que o dono estiver e sai quando ele sair.
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
      const channel = this.findOwnerChannel();
      if (channel) this.join(channel);
    });
    this.client.on('voiceStateUpdate', (oldState, newState) => {
      if (newState.id !== this.ownerId) return;
      if (newState.channel && newState.channelId !== oldState.channelId) this.join(newState.channel);
      else if (!newState.channel) this.leave();
    });
    try {
      await this.client.login(this.token);
    } catch (err) {
      this.setStatus({ state: 'desligado', motivo: `Falha no login: ${(err as Error).message}` });
    }
  }

  async destroy() {
    this.leave();
    await this.client.destroy();
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
    } catch {
      connection.destroy();
      this.setStatus({ state: 'aguardando', bot: this.client.user!.tag });
      this.emit('erro', `Não consegui entrar em ${channel.name}. O bot tem permissão de Conectar e Falar?`);
    }
  }

  private leave() {
    if (!this.guildId) return;
    getVoiceConnection(this.guildId)?.destroy();
    this.guildId = undefined;
    if (this.client.user) this.setStatus({ state: 'aguardando', bot: this.client.user.tag });
  }

  private setStatus(status: BotStatus) {
    this.status = status;
    this.emit('status', status);
  }
}
