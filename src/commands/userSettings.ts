import { Subcommand } from '@sapphire/plugin-subcommands'
import {
  deferredReplyOrEdit,
  getErrorReply,
  userSettingToString,
  userSettingToDiff,
} from '../utils.js'
import { getUserSetting, randomizeUserSetting, setUserSetting } from '../db.js'
import type { InteractionReplyOptions } from 'discord.js'

export class UserSettingsCommand extends Subcommand {
  public constructor(context: Subcommand.Context, options: Subcommand.Options) {
    super(context, {
      ...options,
      name: 'user-settings',
      description: 'ユーザーごとの設定を調整できます。',
      subcommands: [
        {
          name: 'view',
          chatInputRun: 'chatInputView',
        },
        {
          name: 'voice',
          chatInputRun: 'chatInputVoice',
        },
      ],
    })
  }

  override registerApplicationCommands(registry: Subcommand.Registry) {
    registry.registerChatInputCommand((builder) =>
      builder
        .setName(this.name)
        .setDescription(this.description)
        .addSubcommand((command) =>
          command
            .setName('view')
            .setDescription('現在の声の設定を確認します。')
            .addUserOption((option) =>
              option
                .setName('user')
                .setDescription('ユーザーの声の設定を確認できます。')
                .setRequired(false),
            ),
        )
        .addSubcommand((command) =>
          command
            .setName('voice')
            .setDescription('声の設定を変更します。')
            .addBooleanOption((option) =>
              option
                .setName('random')
                .setDescription('声の設定をランダムにします。')
                .setRequired(false),
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
                .setDescription(
                  '声の高さを変更できます。(指定できる範囲: 50〜200)',
                )
                .setRequired(false)
                .setMinValue(50)
                .setMaxValue(200)
                .setAutocomplete(true),
            )
            .addIntegerOption((option) =>
              option
                .setName('speed')
                .setDescription(
                  '声の速度を変更できます。(指定できる範囲: 50〜400)',
                )
                .setRequired(false)
                .setMinValue(50)
                .setMaxValue(400)
                .setAutocomplete(true),
            ),
        ),
    )
  }

  override async autocompleteRun(
    interaction: Subcommand.AutocompleteInteraction,
  ) {
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

  public async chatInputView(
    interaction: Subcommand.ChatInputCommandInteraction,
  ) {
    if (!interaction.inCachedGuild()) return
    await interaction.deferReply({ ephemeral: true })

    const user = interaction.options.getUser('user')

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
      const userSetting = await getUserSetting(
        user ? user.id : interaction.member.id,
      )

      const userNameText = user ? user : '現在'

      interactionReplyOptions = {
        embeds: [
          {
            color: 0x00ff00,
            description:
              `**${userNameText}の声の設定**` +
              '```\n' +
              userSettingToString(userSetting) +
              '\n```',
          },
        ],
        ephemeral: true,
      }
    } catch (error) {
      interactionReplyOptions = getErrorReply(error)
      console.error(error)
    } finally {
      void deferredReplyOrEdit(interaction, interactionReplyOptions)
    }
  }

  public async chatInputVoice(
    interaction: Subcommand.ChatInputCommandInteraction,
  ) {
    if (!interaction.inCachedGuild()) return
    await interaction.deferReply({ ephemeral: true })

    const allowedVoiceList = [
      'show',
      'haruka',
      'hikari',
      'takeru',
      'santa',
      'bear',
    ]

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
      const oldUserSetting = await getUserSetting(interaction.member.id)

      const errorMsg: string[] = []

      const { options } = interaction
      const random = options.getBoolean('random')
      const speaker = options.getString('speaker')
      const pitch = options.getInteger('pitch')
      const speed = options.getInteger('speed')

      if (random) {
        await randomizeUserSetting(interaction.member.id)
      }

      if (speaker !== null) {
        if (allowedVoiceList.includes(speaker)) {
          await setUserSetting(interaction.member.id, 'speaker', speaker)
        } else {
          errorMsg.push(
            [
              `その声(${speaker})は指定できません。指定できる声のリストは、こちらです。`,
              ...allowedVoiceList.map((voice) => '- ' + voice),
            ].join('\n'),
          )
        }
      }

      if (pitch !== null) {
        if (pitch > 49 && pitch < 201) {
          await setUserSetting(interaction.member.id, 'pitch', pitch)
        } else {
          errorMsg.push(
            `その声の高さ(${pitch}%)は指定できません。指定できる声の高さは、50%~200%です。`,
          )
        }
      }

      if (speed !== null) {
        if (speed > 49 && speed < 401) {
          await setUserSetting(interaction.member.id, 'speed', speed)
        } else {
          errorMsg.push(
            `その速度(${speed}%)は指定できません。指定できる声の速度は、50%~400%です。`,
          )
        }
      }
      const userSetting = await getUserSetting(interaction.member.id)

      if (errorMsg.length === 0) {
        interactionReplyOptions = {
          embeds: [
            {
              color: 0x00ff00,
              title: '声の設定を更新しました。',
              description:
                '```ansi\n' +
                userSettingToDiff(oldUserSetting, userSetting) +
                '\n```',
            },
          ],
          ephemeral: true,
        }
      } else {
        interactionReplyOptions = {
          embeds: [
            {
              color: 0xff0000,
              title: 'エラー',
              description: [
                '設定変更中にエラーが発生しました。',
                '詳細情報:',
                ...errorMsg,
              ].join('\n'),
            },
            {
              color: 0x00ff00,
              title: '声の設定を更新しました。',
              description:
                '```ansi\n' +
                userSettingToDiff(oldUserSetting, userSetting) +
                '\n```',
            },
          ],
          ephemeral: true,
        }
      }
      return
    } catch (error) {
      interactionReplyOptions = getErrorReply(error)
      console.error(error)
    } finally {
      void deferredReplyOrEdit(interaction, interactionReplyOptions)
    }
  }
}
