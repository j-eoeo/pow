import { Command, type ChatInputCommand } from '@sapphire/framework'
import { guildCtxManager } from '../index.js'
import { convertContent } from '../contentConverter.js'
import {
  AutocompleteInteraction,
  Collection,
  type InteractionReplyOptions,
  type Sticker,
} from 'discord.js'
import {
  HandleInteractionError,
  HandleInteractionErrorType,
} from '../errors/index.js'
import { checkUserAlreadyJoined } from '../components/preCheck.js'
import { newVoiceBasedChannelId } from '../id.js'
import { deferredReplyOrEdit, getErrorReply } from '../utils.js'

export class ReadCommand extends Command {
  public constructor(
    context: ChatInputCommand.Context,
    options: ChatInputCommand.Options,
  ) {
    super(context, {
      ...options,
      description: '引数に渡されたメッセージを読み上げます。',
    })
  }

  public override registerApplicationCommands(
    registry: ChatInputCommand.Registry,
  ) {
    registry.registerChatInputCommand((builder) =>
      builder
        .setName(this.name)
        .setDescription(this.description)
        .setDMPermission(false)
        .addStringOption((option) =>
          option
            .setName('text')
            .setDescription('喋らせたい内容')
            .setRequired(true),
        )
        .addStringOption((option) =>
          option
            .setName('speaker')
            .setDescription('声の話者を変更できます。')
            .setRequired(false)
            .addChoices(
              { name: 'show', value: 'show' },
              { name: 'haruka', value: 'haruka' },
              { name: 'hikari', value: 'hikari' },
              { name: 'takeru', value: 'takeru' },
              { name: 'santa', value: 'santa' },
              { name: 'bear', value: 'bear' },
            ),
        )
        .addIntegerOption((option) =>
          option
            .setName('pitch')
            .setDescription('声の高さを変更できます。(指定できる範囲: 50〜200)')
            .setRequired(false)
            .setMinValue(50)
            .setMaxValue(200)
            .setAutocomplete(true),
        )
        .addIntegerOption((option) =>
          option
            .setName('speed')
            .setDescription('声の速度を変更できます。(指定できる範囲: 50〜400)')
            .setRequired(false)
            .setMinValue(50)
            .setMaxValue(400)
            .setAutocomplete(true),
        ),
    )
  }

  override async autocompleteRun(interaction: AutocompleteInteraction) {
    const { name, value } = (function () {
      const { name, value } = interaction.options.getFocused(true)
      return { name: name, value: parseInt(value) }
    })()

    switch (true) {
      case value < 50:
        await interaction.respond([{ name: '50（最小値）', value: 50 }])
        break
      case name === 'pitch' && value > 200:
        await interaction.respond([{ name: '200（最大値）', value: 200 }])
        break
      case value > 400:
        await interaction.respond([{ name: '400（最大値）', value: 400 }])
        break
      case Number.isInteger(value):
        await interaction.respond([{ name: value.toString(), value: value }])
        break
      default:
        await interaction.respond([])
    }
  }

  public override async chatInputRun(
    interaction: ChatInputCommand.Interaction,
  ) {
    if (!interaction.inCachedGuild()) return
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

      const text = interaction.options.getString('text', true)

      const connectionCtx = guildCtxManager
        .get(interaction.member.guild)
        .connectionManager.getWithVoiceChannelId(
          newVoiceBasedChannelId(voiceChannel),
        )
      if (connectionCtx === undefined)
        throw new HandleInteractionError(
          HandleInteractionErrorType.userNotWithBot,
        )

      const convertedMessage = convertContent(
        text,
        [],
        new Collection<string, Sticker>(),
        interaction.guild.id,
        interaction.client,
      )
        .trim()
        .replace('\n', '')
      if (convertedMessage.length === 0) return
      await connectionCtx.addMessage(convertedMessage, interaction, {
        speaker: interaction.options.getString('speaker'),
        pitch: interaction.options.getInteger('pitch'),
        speed: interaction.options.getInteger('speed'),
      })
      interactionReplyOptions = {
        content: 'メッセージを読み上げキューに追加しました。',
      }
    } catch (error) {
      interactionReplyOptions = getErrorReply(error)
      console.error(error)
    } finally {
      void deferredReplyOrEdit(interaction, interactionReplyOptions)
    }
  }
}
