import { Client, type Guild, ChannelType } from 'discord.js'
import { WorkerClientMap } from './worker.js'
import { workerClientMap, workerReady } from './index.js'
import { ConnectionCtxManager, LeaveCause } from './connectionCtx.js'
import {
  AlreadyJoinedError,
  NoWorkerError,
  NotReadyWorkerError,
} from './errors/index.js'
import {
  type GuildTextBasedChannelId,
  type VoiceBasedChannelId,
  type UserId,
} from './id.js'

const getBots = async (guild: Guild, worker: WorkerClientMap) => {
  const results = await Promise.allSettled(
    Array.from(worker.keys()).map((id) => guild.members.fetch(id)),
  )
  return results
    .flatMap((r) => (r.status === 'fulfilled' ? r.value.id : []))
    .sort((a, b) => Number(BigInt(a) - BigInt(b)))
}

export class GuildContext {
  guild: Guild
  bots: Promise<string[]>
  connectionManager: ConnectionCtxManager

  constructor(guild: Guild, worker: WorkerClientMap) {
    this.guild = guild
    this.bots = getBots(guild, worker)
    this.connectionManager = new ConnectionCtxManager()
  }

  checkAlreadyJoined(voiceChannelId: VoiceBasedChannelId) {
    if (this.connectionManager.channelMap.has(voiceChannelId))
      throw new AlreadyJoinedError()
  }

  async join({
    voiceChannelId,
    readChannelId,
    skipUser = new Set(),
  }: {
    voiceChannelId: VoiceBasedChannelId
    readChannelId: GuildTextBasedChannelId
    skipUser?: Set<UserId>
  }) {
    this.checkAlreadyJoined(voiceChannelId)

    const vcArray = (await this.guild.channels.fetch())
      .map((v) => {
        if (
          (v?.type === ChannelType.GuildVoice ||
            v?.type === ChannelType.GuildStageVoice) &&
          v.joinable
        ) {
          return v
        } else {
          return null
        }
      })
      .flatMap((data) => {
        return data ?? []
      })
      .sort((a, b) => a.rawPosition - b.rawPosition)
      .map((data) => {
        return data.id
      })

    let workerId = (await this.bots)[vcArray.indexOf(voiceChannelId)]

    if (workerId === undefined) {
      workerId = (await this.bots).find(
        (botId) =>
          ![...this.connectionManager.values()]
            .map((connectionCtx) => connectionCtx.connection.joinConfig.group)
            .includes(botId),
      )
    } else {
      const oldConnectionCtx = [...this.connectionManager.values()].find(
        (v) => v.connection.joinConfig.group === workerId,
      )
      if (oldConnectionCtx !== undefined) {
        const oldVoiceChannelId = oldConnectionCtx.connection.joinConfig
          .channelId as VoiceBasedChannelId
        const forOldCtxWorkerId = (await this.bots).find(
          (botId) =>
            ![...this.connectionManager.values()]
              .map((connectionCtx) => connectionCtx.connection.joinConfig.group)
              .includes(botId) && botId !== workerId,
        )
        if (forOldCtxWorkerId === undefined) {
          throw new NoWorkerError()
        }
        const forOldCtxWorker =
          workerClientMap.get(forOldCtxWorkerId) ??
          (() => {
            throw new NoWorkerError()
          })()
        await this.leave({ voiceChannelId: oldVoiceChannelId })
        this.connectionManager.connectionJoin({
          voiceChannelId: oldVoiceChannelId,
          guildId: this.guild.id,
          readChannelId: oldConnectionCtx.readChannelId,
          worker: forOldCtxWorker,
          client: this.guild.client,
          skipUser,
        })
      }
    }
    if (workerId === undefined) {
      throw new NoWorkerError()
    }
    const worker =
      workerClientMap.get(workerId) ??
      (() => {
        throw new NoWorkerError()
      })()
    this.connectionManager.connectionJoin({
      voiceChannelId,
      guildId: this.guild.id,
      readChannelId,
      worker,
      client: this.guild.client,
      skipUser,
    })
    return worker
  }
  leave({
    voiceChannelId,
    cause,
  }: {
    voiceChannelId: VoiceBasedChannelId
    cause?: LeaveCause | undefined
  }) {
    const workerId = this.connectionManager.connectionLeave({
      voiceChannelId: voiceChannelId,
      cause,
    })
    return workerId
  }
  async addBot(workerId: string) {
    ;(await this.bots).push(workerId)
  }
  async leaveAll({ cause }: { cause: LeaveCause }) {
    await Promise.allSettled(
      Array.from(
        this.connectionManager.channelMap.keys(),
        async (voiceChannelId) => await this.leave({ voiceChannelId, cause }),
      ),
    )
  }
}

export class GuildCtxManager extends Map<Guild, GuildContext> {
  client: Client
  constructor(client: Client) {
    super()
    this.client = client
  }
  override get(guild: Guild) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    if (this.has(guild)) return super.get(guild)!
    if (!workerReady) throw new NotReadyWorkerError()
    const guildContext = new GuildContext(guild, workerClientMap)
    this.set(guild, guildContext)
    return guildContext
  }
  async deleteAsync(guild: Guild) {
    await this.get(guild).leaveAll({ cause: LeaveCause.reset })
    return super.delete(guild)
  }
}
