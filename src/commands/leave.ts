import { Command, type ChatInputCommand } from '@sapphire/framework'
import { guildCtxManager } from '../index.js'
import { checkUserAlreadyJoined } from '../components/preCheck.js'
import type { InteractionReplyOptions } from 'discord.js'
import { LeaveCause } from '../connectionCtx.js'
import { newGuildTextBasedChannelId, newVoiceBasedChannelId } from '../id.js'
import { deferredReplyOrEdit, getErrorReply } from '../utils.js'

export class LeaveCommand extends Command {
  public constructor(
    context: ChatInputCommand.Context,
    options: ChatInputCommand.Options,
  ) {
    super(context, {
      ...options,
      description: 'ボイスチャンネルから退出します。',
    })
  }

  public override registerApplicationCommands(
    registry: ChatInputCommand.Registry,
  ) {
    registry.registerChatInputCommand((builder) =>
      builder
        .setName(this.name)
        .setDescription(this.description)
        .setDMPermission(false),
    )
  }
  public override async chatInputRun(
    interaction: ChatInputCommand.Interaction,
  ) {
    if (!interaction.inCachedGuild() || interaction.channel == null) return
    const user = await interaction.member.fetch()
    const voiceChannel = user.voice.channel

    let interactionReplyOptions: InteractionReplyOptions = {
      embeds: [
        {
          color: 0xff0000,
          title: '予期せぬエラーが発生しました。',
        },
      ],
      ephemeral: true,
    }

    try {
      checkUserAlreadyJoined(voiceChannel)

      await interaction.deferReply()

      const ctx = guildCtxManager.get(interaction.member.guild)
      const textChannelId = ctx.connectionManager.channelMap.get(
        newVoiceBasedChannelId(voiceChannel),
      )
      const cause =
        newGuildTextBasedChannelId(interaction.channel) === textChannelId
          ? undefined
          : LeaveCause.command
      const workerId = await ctx.leave({
        voiceChannelId: newVoiceBasedChannelId(voiceChannel),
        cause,
      })

      interactionReplyOptions = {
        embeds: [
          {
            color: 0x00ff00,
            title: 'ボイスチャンネルから退出しました。',
            description: [
              `担当BOT: <@${workerId}>`,
              `テキストチャンネル: <#${textChannelId}>`,
              `ボイスチャンネル: ${voiceChannel}`,
              'またのご利用をお待ちしております。',
            ].join('\n'),
          },
        ],
      }
    } catch (error) {
      interactionReplyOptions = getErrorReply(error)
      console.error(error)
    } finally {
      void deferredReplyOrEdit(interaction, interactionReplyOptions)
    }
  }
}
