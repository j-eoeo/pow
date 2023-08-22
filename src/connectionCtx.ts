import debug from 'debug'
const debug__ConnectionContext = debug('connectionCtx.js:ConnectionContext')
const debug__ErrorHandler = debug('connectionCtx.js:ErrorHandler')

import {
  joinVoiceChannel,
  entersState,
  createAudioResource,
  StreamType,
  createAudioPlayer,
  AudioPlayerStatus,
  AudioPlayer,
  VoiceConnection,
} from '@discordjs/voice'

import {
  Client,
  type VoiceBasedChannel,
  Message,
  ChatInputCommandInteraction,
  type DiscordErrorData,
  type GuildTextBasedChannel,
  User,
} from 'discord.js'
import { Queue } from './utils.js'
import { ResponseError, fetchAudioStream } from './voiceRead.js'
import { getUserSetting } from './db.js'
import { Readable } from 'node:stream'

class ConnectionContext {
  readChannel: GuildTextBasedChannel
  readQueue: Queue<{ audio: Readable }>
  player: AudioPlayer | null = null
  connection: VoiceConnection
  skipUser: Set<User> = new Set()

  constructor(readChannel: GuildTextBasedChannel, connection: VoiceConnection) {
    this.readChannel = readChannel
    this.readQueue = new Queue(this._readMessage.bind(this))
    this.connection = connection
  }

  private async _readMessage({ audio }: { audio: Readable }) {
    this.player = createAudioPlayer()
    const resource = createAudioResource(audio, {
      inputType: StreamType.Arbitrary,
    })
    this.connection.subscribe(this.player)
    this.player.play(resource)
    await entersState(this.player, AudioPlayerStatus.Playing, 5e3)
    debug__ConnectionContext('read started')
    await entersState(this.player, AudioPlayerStatus.Idle, 2 ** 31 - 1)
    debug__ConnectionContext('read finished')
  }

  async addMessage(
    text: string,
    ctx: Message | ChatInputCommandInteraction<'cached'>,
  ) {
    const userSetting = await getUserSetting(
      ctx instanceof Message ? ctx.author.id : ctx.user.id,
    )
    try {
      debug__ConnectionContext('fetching audio')
      const audioStream = await fetchAudioStream(
        text,
        userSetting?.speaker,
        userSetting?.pitch,
        userSetting?.speed,
      )
      if (audioStream === null) return
      const audio = Readable.fromWeb(audioStream)
      debug__ConnectionContext('got response, adding to queue')
      this.readQueue.add({ audio })
    } catch (error) {
      const message =
        error instanceof ResponseError
          ? {
              embeds: [
                {
                  color: 0xff0000,
                  title: 'APIリクエストエラー',
                  description: `${error.response.status}: ${error.response.statusText}`,
                },
              ],
            }
          : {
              embeds: [
                {
                  color: 0xff0000,
                  title: 'リクエストエラー',
                  description: `${error}`,
                },
              ],
            }

      if (ctx instanceof ChatInputCommandInteraction) {
        return await ctx.followUp(message)
      } else {
        return await ctx.reply(message).catch((err: DiscordErrorData) => {
          if (err.code !== 50013) throw err
          debug__ErrorHandler(
            `Error code ${err.code}: Missing send messages permission.`,
          )
        })
      }
    }
  }

  async updateSkipUser(user: User, isSkip: boolean) {
    if (isSkip) {
      this.skipUser.add(user)
    } else {
      this.skipUser.delete(user)
    }
  }
}

export class ConnectionCtxManager extends Map<
  GuildTextBasedChannel,
  ConnectionContext
> {
  channelMap: Map<VoiceBasedChannel, GuildTextBasedChannel>
  constructor() {
    super()
    this.channelMap = new Map()
  }

  connectionJoin(
    voiceChannel: VoiceBasedChannel,
    guildId: string,
    readChannel: GuildTextBasedChannel,
    worker: Client,
  ) {
    if (this.channelMap.get(voiceChannel) !== undefined)
      throw new Error('Already joined')
    this.channelMap.set(voiceChannel, readChannel)
    const connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: guildId,
      group: worker.user!.id,
      adapterCreator: worker.guilds.cache.get(guildId)!.voiceAdapterCreator,
    })
    connection.once('disconnect', () => {
      debug__ConnectionContext('vc disconnected')
      this.get(readChannel)!.readQueue.purge()
      connection?.destroy()
      this.delete(readChannel)
    })
    this.set(readChannel, new ConnectionContext(readChannel, connection))
  }
  connectionLeave(voiceChannel: VoiceBasedChannel) {
    const readChannel = this.channelMap.get(voiceChannel)
    if (readChannel == null) throw Error()
    const connection = this.get(readChannel)?.connection
    if (connection == null) return ''
    const workerId = connection.joinConfig.group
    connection.disconnect()
    this.channelMap.delete(voiceChannel)
    this.delete(readChannel)
    return workerId
  }
}
