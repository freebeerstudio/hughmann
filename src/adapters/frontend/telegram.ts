import { Bot, type Context } from 'grammy'
import type { Runtime } from '../../runtime/runtime.js'
import type { Skill } from '../../runtime/skills.js'

type BotContext = Context

const MAX_MESSAGE_LENGTH = 4096 // Telegram limit

/**
 * Telegram bot frontend for HughMann.
 * Supports text chat, skill commands, and domain switching.
 */
export async function startTelegramBot(runtime: Runtime, token: string): Promise<void> {
  const bot = new Bot(token)
  const systemName = runtime.context.config.systemName

  // ─── Commands ───────────────────────────────────────────────────────────

  bot.command('start', async (ctx) => {
    await ctx.reply(
      `*${systemName} is online.*\n\n` +
      `I'm your personal AI operating system. Send me a message to chat, or use commands:\n\n` +
      `/morning - Morning dashboard\n` +
      `/closeout - Afternoon closeout\n` +
      `/status - Quick status\n` +
      `/habits - Habit check-in\n` +
      `/review - Weekly review\n` +
      `/skills - List all skills\n` +
      `/domains - List domains\n` +
      `/domain <name> - Switch domain\n` +
      `/do <task> - Autonomous task`,
      { parse_mode: 'Markdown' }
    )
  })

  bot.command('skills', async (ctx) => {
    const builtins = runtime.skills.listBuiltin()
    const custom = runtime.skills.listCustom()

    let msg = '*Available Skills:*\n\n'
    for (const s of builtins) {
      const tier = s.complexity === 'autonomous' ? '(opus+tools)' : s.complexity === 'lightweight' ? '(haiku)' : '(sonnet)'
      msg += `/${s.id} - ${s.description} ${tier}\n`
    }
    if (custom.length > 0) {
      msg += '\n*Custom:*\n'
      for (const s of custom) {
        msg += `/${s.id} - ${s.description}\n`
      }
    }
    await ctx.reply(msg, { parse_mode: 'Markdown' })
  })

  bot.command('domains', async (ctx) => {
    const domains = runtime.getAvailableDomains()
    let msg = '*Domains:*\n\n'
    for (const d of domains) {
      const active = d.slug === runtime.activeDomain ? ' ← active' : ''
      const iso = d.isolation === 'isolated' ? '[isolated]' : '[personal]'
      msg += `*${d.name}* (${d.domainType}) ${iso}${active}\n`
    }
    msg += '\nUse /domain <name> to switch.'
    await ctx.reply(msg, { parse_mode: 'Markdown' })
  })

  bot.command('domain', async (ctx) => {
    const args = ctx.match?.trim()
    if (!args) {
      runtime.setDomain(null)
      await ctx.reply('Cleared domain. Back to general context.')
      return
    }
    try {
      runtime.setDomain(args)
      const domain = runtime.context.domains.get(runtime.activeDomain!)
      await ctx.reply(`Switched to *${domain?.name ?? args}* [${domain?.isolation}]`, { parse_mode: 'Markdown' })
    } catch (err) {
      await ctx.reply(`Error: ${err instanceof Error ? err.message : String(err)}`)
    }
  })

  bot.command('do', async (ctx) => {
    const task = ctx.match?.trim()
    if (!task) {
      await ctx.reply('Usage: /do <task description>')
      return
    }
    await executeAutonomousTask(ctx, runtime, task, systemName)
  })

  // Register skill commands
  const allSkills = runtime.skills.list()
  for (const skill of allSkills) {
    bot.command(skill.id, async (ctx) => {
      const extraArgs = ctx.match?.trim() ?? ''
      await executeSkill(ctx, runtime, skill, extraArgs, systemName)
    })
  }

  // ─── Text messages (chat) ───────────────────────────────────────────────

  bot.on('message:text', async (ctx) => {
    const text = ctx.message.text
    if (!text || text.startsWith('/')) return

    // Init session if needed
    await runtime.initSession()

    // Send typing indicator
    await ctx.replyWithChatAction('typing')

    try {
      let fullResponse = ''
      for await (const chunk of runtime.chatStream(text)) {
        if (chunk.type === 'text') {
          fullResponse += chunk.content
        }
      }

      await sendLongMessage(ctx, fullResponse)
    } catch (err) {
      await ctx.reply(`Error: ${err instanceof Error ? err.message : String(err)}`)
    }
  })

  // ─── Start bot ──────────────────────────────────────────────────────────

  bot.catch((err) => {
    console.error('Telegram bot error:', err.message)
  })

  console.log(`  ${systemName} Telegram bot is online.`)
  console.log(`  Press Ctrl+C to stop.`)
  console.log()

  await bot.start()
}

// ─── Helpers ────────────────────────────────────────────────────────────────

async function executeSkill(
  ctx: BotContext,
  runtime: Runtime,
  skill: Skill,
  extraArgs: string,
  systemName: string,
) {
  let prompt = skill.prompt
  if (extraArgs) {
    prompt += `\n\nAdditional context from user: ${extraArgs}`
  }

  // Auto-switch domain
  const previousDomain = runtime.activeDomain
  if (skill.domain) {
    try { runtime.setDomain(skill.domain) } catch { /* proceed */ }
  }

  await ctx.replyWithChatAction('typing')

  try {
    if (skill.complexity === 'autonomous') {
      await executeAutonomousTask(ctx, runtime, prompt, systemName)
    } else {
      // Conversational
      await runtime.initSession()

      let fullResponse = ''
      for await (const chunk of runtime.chatStream(prompt)) {
        if (chunk.type === 'text') {
          fullResponse += chunk.content
        }
      }

      await sendLongMessage(ctx, fullResponse)
    }
  } catch (err) {
    await ctx.reply(`Skill failed: ${err instanceof Error ? err.message : String(err)}`)
  }

  // Restore domain
  if (skill.domain && previousDomain !== runtime.activeDomain) {
    runtime.setDomain(previousDomain)
  }
}

async function executeAutonomousTask(
  ctx: BotContext,
  runtime: Runtime,
  task: string,
  _systemName: string,
) {
  await runtime.initSession()
  await ctx.replyWithChatAction('typing')

  let fullResponse = ''
  const toolLog: string[] = []

  try {
    for await (const chunk of runtime.doTaskStream(task)) {
      switch (chunk.type) {
        case 'tool_use':
          toolLog.push(`⚙ ${chunk.content}`)
          break
        case 'text':
          fullResponse += chunk.content
          break
        case 'status':
          toolLog.push(`✓ ${chunk.content}`)
          break
      }
    }

    // Send tool log first if there was tool use
    if (toolLog.length > 0) {
      const logText = toolLog.slice(-10).join('\n') // Last 10 tool actions
      await ctx.reply(`_${logText}_`, { parse_mode: 'Markdown' })
    }

    // Then send the response
    if (fullResponse) {
      await sendLongMessage(ctx, fullResponse)
    }
  } catch (err) {
    await ctx.reply(`Task failed: ${err instanceof Error ? err.message : String(err)}`)
  }
}

/**
 * Send a long message, splitting at Telegram's 4096 char limit.
 */
async function sendLongMessage(
  ctx: BotContext,
  text: string,
) {
  if (!text.trim()) return

  // Split into chunks at paragraph boundaries where possible
  const chunks: string[] = []
  let remaining = text

  while (remaining.length > MAX_MESSAGE_LENGTH) {
    // Try to split at a double newline
    let splitIdx = remaining.lastIndexOf('\n\n', MAX_MESSAGE_LENGTH)
    if (splitIdx === -1 || splitIdx < MAX_MESSAGE_LENGTH / 2) {
      // Fall back to single newline
      splitIdx = remaining.lastIndexOf('\n', MAX_MESSAGE_LENGTH)
    }
    if (splitIdx === -1 || splitIdx < MAX_MESSAGE_LENGTH / 2) {
      // Hard split
      splitIdx = MAX_MESSAGE_LENGTH
    }

    chunks.push(remaining.slice(0, splitIdx))
    remaining = remaining.slice(splitIdx).trimStart()
  }

  if (remaining) chunks.push(remaining)

  for (const chunk of chunks) {
    // Try to send as Markdown, fall back to plain text
    try {
      await ctx.reply(chunk, { parse_mode: 'Markdown' })
    } catch {
      await ctx.reply(chunk)
    }
  }
}
