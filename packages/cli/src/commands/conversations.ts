import { flag } from '../args'
import { listLimit, pageSize, take, type Command, type Ctx } from '../context'
import { details, table, when } from '../output'

/**
 * Lire ce qui s'est échangé : les conversations, leurs messages, les contacts.
 * Aucune écriture ici.
 */

/** Le texte d'un message sur une ligne, coupé. */
function preview(text: string | null, type: string): string {
  const line = (text ?? `[${type}]`).replace(/\s+/g, ' ')
  return line.length > 60 ? `${line.slice(0, 59)}…` : line
}

async function listConversations(ctx: Ctx): Promise<number> {
  const limit = listLimit(ctx.args)
  const channelId = flag(ctx.args, 'channel')
  const contactId = flag(ctx.args, 'contact')
  const phone = flag(ctx.args, 'phone')
  const items = await take(ctx.scope().conversations.each({
    limit: pageSize(limit),
    ...(channelId ? { channelId } : {}), ...(contactId ? { contactId } : {}), ...(phone ? { phone } : {})
  }), limit)
  ctx.print(items, () => {
    for (const line of table(items.map(c => [
      c.id, c.contact.displayName ?? c.contact.identity, c.channelName,
      c.window.open ? 'window open' : 'window closed', when(c.lastInboundAt)
    ]))) ctx.output.out(line)
  }, items.length ? [`nodium messages list ${items[0]!.id}`] : ['nodium listen --forward <local url>'])
  return 0
}

async function getConversation(ctx: Ctx): Promise<number> {
  const conversation = await ctx.scope().conversations.get(ctx.args.positionals[0]!)
  ctx.print(conversation, () => details(conversation).forEach(line => ctx.output.out(line)), [`nodium messages list ${conversation.id}`])
  return 0
}

async function listMessages(ctx: Ctx): Promise<number> {
  const limit = listLimit(ctx.args)
  const items = await take(ctx.scope().messages.each(ctx.args.positionals[0]!, { limit: pageSize(limit) }), limit)
  ctx.print(items, () => {
    for (const line of table(items.map(m => [
      when(m.createdAt), m.direction === 'inbound' ? '←' : '→', m.status, m.id, preview(m.textContent, m.type)
    ]))) ctx.output.out(line)
  }, items.length ? [`nodium messages get ${items[0]!.id}`] : [])
  return 0
}

async function getMessage(ctx: Ctx): Promise<number> {
  const message = await ctx.scope().messages.get(ctx.args.positionals[0]!)
  ctx.print(message, () => details(message).forEach(line => ctx.output.out(line)))
  return 0
}

async function listContacts(ctx: Ctx): Promise<number> {
  const limit = listLimit(ctx.args)
  const q = flag(ctx.args, 'search')
  const items = await take(ctx.scope().contacts.each({ limit: pageSize(limit), ...(q ? { q } : {}) }), limit)
  ctx.print(items, () => {
    for (const line of table(items.map(c => [
      c.id, c.displayName ?? '—', c.phone ?? c.email ?? c.externalId ?? '—', c.optInAt ? 'opted in' : c.optOutAt ? 'opted out' : '', c.blocked ? 'blocked' : ''
    ]))) ctx.output.out(line)
  }, items.length ? [`nodium contacts get ${items[0]!.id}`] : [])
  return 0
}

async function getContact(ctx: Ctx): Promise<number> {
  const contact = await ctx.scope().contacts.get(ctx.args.positionals[0]!)
  ctx.print(contact, () => details(contact).forEach(line => ctx.output.out(line)), [`nodium conversations list --contact ${contact.id}`])
  return 0
}

const LIMIT_HELP = '  --limit <n>       At most n items, newest first (default 20); pages are followed for you.'

export const CONVERSATION_COMMANDS: Command[] = [
  {
    path: ['conversations', 'list'], summary: 'The latest conversations.', flags: ['limit', 'channel', 'contact', 'phone'],
    help: `${LIMIT_HELP}
  --channel <id>    Only on this number.
  --contact <id>    Only with this contact.
  --phone <number>  Only with the contact who has this number.`,
    run: listConversations
  },
  { path: ['conversations', 'get'], args: ['<id>'], summary: 'One conversation and its 24-hour window.', run: getConversation },
  {
    path: ['messages', 'list'], args: ['<conversationId>'], summary: 'The messages of a conversation, newest first.', flags: ['limit'],
    help: LIMIT_HELP, run: listMessages
  },
  { path: ['messages', 'get'], args: ['<id>'], summary: 'One message: its status, and why it failed.', run: getMessage },
  {
    path: ['contacts', 'list'], summary: 'Your contacts.', flags: ['limit', 'search'],
    help: `${LIMIT_HELP}
  --search <text>   A name, a number or an e-mail.`,
    run: listContacts
  },
  { path: ['contacts', 'get'], args: ['<id>'], summary: 'One contact.', run: getContact }
]
