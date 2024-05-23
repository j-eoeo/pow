import { Command, type ChatInputCommand } from '@sapphire/framework'
import { guildCtxManager } from '../index.js'
import { PermissionFlagsBits, type InteractionReplyOptions } from 'discord.js'
import { deferredReplyOrEdit, getErrorReply } from '../utils.js'

export class ResetCommand extends Command {
  public constructor(
    context: ChatInputCommand.Context,
    options: ChatInputCommand.Options,
  ) {
    super(context, {
      ...options,
      description:
        'このサーバーでの参加状態を初期化します。(⚠VCからBOTが退出します。)',
    })
  }

  public override registerApplicationCommands(
    registry: ChatInputCommand.Registry,
  ) {
    registry.registerChatInputCommand((builder) =>
      builder
        .setName(this.name)
        .setDescription(this.description)
        .setDefaultMemberPermissions(PermissionFlagsBits.MoveMembers)
        .setDMPermission(false),
    )
  }
  public override async chatInputRun(
    interaction: ChatInputCommand.Interaction,
  ) {
    if (!interaction.inCachedGuild()) return
    await interaction.deferReply()

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
      await guildCtxManager.deleteAsync(interaction.guild)
      interactionReplyOptions = {
        embeds: [
          {
            color: 0x00ff00,
            title: `参加状態を初期化しました。`,
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
