import { Nodium, NodiumError, type Channel } from '@nodium.io/whatsapp'
import { UsageError, flag, readInteger } from '../args'
import { deleteConfig, maskKey, resolveKey, writeConfig } from '../config'
import { take, type Command, type Ctx } from '../context'
import { paint, table, when } from '../output'

/**
 * La clé et le compte : `login`, `logout`, `status`, `health`, `events`.
 */

/** Un numéro en une ligne : son état d'abord. */
export function numberState(channel: Channel): string {
  if (!channel.isActive) return 'off'
  if (channel.paymentMissing) return 'payment missing'
  return channel.qualityRating ? `on (${channel.qualityRating.toLowerCase()})` : 'on'
}

/**
 * Les commandes à lancer ensuite, d'après les numéros et les abonnements.
 * `activeWebhooks` à `null` : la clé ne lit pas les abonnements, rien n'est
 * conseillé à leur sujet.
 */
export function nextSteps(numbers: number, activeWebhooks: number | null, seesAllClients: boolean): string[] {
  if (!numbers) return seesAllClients ? ['nodium tenants list', 'nodium connect-link new --tenant <id>'] : ['nodium connect-link new']
  if (activeWebhooks === 0) return ['nodium listen --forward <local url>', 'nodium webhooks new --url <https://…> --event message.received']
  return ['nodium numbers list', 'nodium send --channel <id> --to <+33…> --text "Hello"']
}

async function login(ctx: Ctx): Promise<number> {
  let key = flag(ctx.args, 'key')
  if (!key) {
    key = ctx.interactive
      ? await ctx.io.readSecret('API key (nod_…, Settings › API keys in the console): ')
      : await ctx.io.readStdin()
    key = key.trim()
  }
  if (!key) throw new UsageError('No key given. Paste it when asked, pipe it (`echo $KEY | nodium login`), or pass --key.')

  const current = await new Nodium(key, { baseUrl: ctx.baseUrl, ...(ctx.fetch ? { fetch: ctx.fetch } : {}) }).keys.current()
  const baseUrl = flag(ctx.args, 'base-url')
  writeConfig(ctx.configPath, { key, ...(baseUrl ? { baseUrl } : {}) })

  ctx.print({ key: current, saved: ctx.configPath }, () => {
    ctx.output.out(`${paint(ctx.output, 'green', 'Logged in')} with ${maskKey(key!)} (account ${current.accountId}${current.pinned ? ', pinned to one client' : ''}).`)
    ctx.output.out(paint(ctx.output, 'dim', `Saved to ${ctx.configPath} (readable by you only). NODIUM_KEY and --key still win over it.`))
  }, ['nodium status'])
  return 0
}

async function logout(ctx: Ctx): Promise<number> {
  const removed = deleteConfig(ctx.configPath)
  ctx.print({ removed, path: ctx.configPath }, () => {
    ctx.output.out(removed ? `Logged out: ${ctx.configPath} deleted.` : 'No saved key: nothing to do.')
    if (ctx.env.NODIUM_KEY) ctx.output.out(paint(ctx.output, 'yellow', 'NODIUM_KEY is still set in this shell.'))
  })
  return 0
}

/** Au-delà, `status` écrit « 1000+ » : compter tous les clients d'un gros compte serait long. */
const CLIENTS_COUNTED = 1000

async function status(ctx: Ctx): Promise<number> {
  const nodium = ctx.nodium()
  const key = await nodium.keys.current()
  const tenant = flag(ctx.args, 'tenant')
  const seesAll = !tenant && !key.pinned
  // Une clé du compte, sans client nommé, voit les numéros de tous ses clients.
  const [numbers, clients, subscriptions] = await Promise.all([
    seesAll ? nodium.channels.list({ scope: 'account' }) : ctx.scope().channels.list(),
    // « Mon entreprise » n'est pas dans la liste des clients.
    seesAll ? take(nodium.tenants.each({ limit: 100 }), CLIENTS_COUNTED).then(items => items.length) : Promise.resolve(null),
    // Une clé épinglée à « Mon entreprise » ne lit pas ses abonnements (404) :
    // ils portent les événements de tous les clients.
    ctx.scope().webhooks.list().then(
      r => r.subscriptions,
      (error: unknown) => {
        if (error instanceof NodiumError && error.status === 404) return null
        throw error
      }
    )
  ])
  const connected = numbers.filter(n => !n.isTest)
  const active = subscriptions ? subscriptions.filter(s => s.isActive).length : null
  const next = nextSteps(connected.length, active, seesAll)
  const webhooks = subscriptions ? { total: subscriptions.length, active } : null

  ctx.print({ key, clients, numbers, webhooks, next }, () => {
    const { out } = ctx.output
    const label = key.label ? ` "${key.label}"` : ''
    const scope = key.client
      ? `pinned to ${key.client.isHome ? 'My company' : `"${key.client.name}"`} (${key.client.id})`
      : 'every client of the account'
    out(`Authentication: ${paint(ctx.output, 'green', 'authenticated')}`)
    out(`Key: ${maskKey(resolveKey(flag(ctx.args, 'key'), ctx.env, ctx.config).key)}${label}, ${key.expiresAt ? `expires ${when(key.expiresAt)}` : 'never expires'}`)
    out(`Account: ${key.accountName} (${key.accountId})`)
    out(`Access: ${scope}`)
    if (clients !== null) out(`Clients: ${clients >= CLIENTS_COUNTED ? `${CLIENTS_COUNTED}+` : clients}`)
    out(`WhatsApp Numbers: ${connected.length}${connected.length ? ` (${connected.filter(n => n.isActive).length} on)` : ''}`)
    out(`Webhooks: ${subscriptions ? `${active} active of ${subscriptions.length}` : 'not visible with this key (pinned to My company)'}`)
  }, next)
  return 0
}

async function health(ctx: Ctx): Promise<number> {
  const result = await ctx.nodium().health()
  ctx.print(result, () => {
    ctx.output.out(result.healthy ? paint(ctx.output, 'green', 'Healthy.') : paint(ctx.output, 'red', 'Something needs your attention:'))
    for (const alert of result.alerts) ctx.output.out(`  ${alert.level.padEnd(8)} ${alert.code}  ${alert.message} (number ${alert.channelId})`)
  }, result.healthy ? [] : [...new Set(result.alerts.map(a => `nodium numbers check ${a.channelId}`))])
  return result.healthy ? 0 : 1
}

async function events(ctx: Ctx): Promise<number> {
  const after = readInteger(ctx.args, 'after', 0)
  const limit = readInteger(ctx.args, 'limit', 1)
  if (limit !== null && limit > 500) throw new UsageError('--limit must be 500 or less.')
  const page = await ctx.scope().events.list(after ?? undefined, limit ?? undefined)
  ctx.print(page, () => {
    if (after === null) ctx.output.out(`The log is at event #${page.next_after}. Read what comes next with --after ${page.next_after}.`)
    for (const line of table(page.data.map(e => [String(e.seq), when(e.occurred_at), e.event, e.id, e.external_id ?? '']))) ctx.output.out(line)
  }, [`nodium events --after ${page.next_after}`])
  return 0
}

export const ACCOUNT_COMMANDS: Command[] = [
  {
    path: ['login'], summary: 'Save your API key for the next commands.', needsKey: false,
    help: `Asks for the key (hidden), or reads it from a pipe or --key, checks it with Nodium and
saves it to $XDG_CONFIG_HOME/nodium/config.json (~/.config by default), readable by you
only. --base-url is saved with it. NODIUM_KEY and --key still win over the saved key.`,
    run: login
  },
  { path: ['logout'], summary: 'Forget the saved key.', needsKey: false, run: logout },
  {
    path: ['status'], summary: 'What your key is, your numbers, your webhooks, and what to do next.',
    run: status
  },
  { path: ['health'], summary: 'Anything wrong with your numbers? Exit code 1 if so.', run: health },
  {
    path: ['events'], summary: 'Read the event log (what your webhooks receive), from a cursor.',
    flags: ['after', 'limit'],
    help: `  --after <seq>   The events after this number. Without it: where the log is now.
  --limit <n>     At most n events (1 to 500, default 100).`,
    run: events
  }
]
