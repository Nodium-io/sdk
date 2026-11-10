import { WEBHOOK_EVENTS, type WebhookUpdate } from '@nodium.io/whatsapp'
import { UsageError, flag, flagAll, hasFlag } from '../args'
import { listLimit, pageSize, take, type Command, type Ctx } from '../context'
import { paint, table, when } from '../output'

/**
 * Les abonnements aux événements, et leurs livraisons.
 *
 * ⚠️ Le secret de signature ne se montre qu'à la création et au changement de
 *    secret : la commande le dit, une fois.
 */

/** `--event a --event b,c` → `['a', 'b', 'c']`, chaque nom connu (`*` = tous). */
export function readEvents(values: string[]): string[] {
  const names = values.flatMap(v => v.split(',')).map(n => n.trim()).filter(Boolean)
  const known = new Set<string>([...WEBHOOK_EVENTS, '*'])
  const unknown = names.filter(n => !known.has(n))
  if (unknown.length) throw new UsageError(`Unknown event ${unknown.map(n => `"${n}"`).join(', ')}. Known: ${WEBHOOK_EVENTS.join(', ')}, or * for all.`)
  return names
}

function printSecret(ctx: Ctx, secret: string): void {
  ctx.output.out(`Signing secret: ${secret}`)
  ctx.output.err(paint(ctx.output, 'yellow', 'Store it now (for example in NODIUM_WEBHOOK_SECRET): it is never shown again.'))
}

async function list(ctx: Ctx): Promise<number> {
  const result = await ctx.scope().webhooks.list()
  ctx.print(result, () => {
    if (!result.subscriptions.length) ctx.output.out('No subscription.')
    for (const line of table(result.subscriptions.map(s => [
      s.id, s.isActive ? 'active' : `paused${s.disabledReason ? ` (${s.disabledReason})` : ''}`, s.url, s.events.join(','), s.lastError ? `last error: ${s.lastError}` : ''
    ]))) ctx.output.out(line)
  }, result.subscriptions.length
    ? [`nodium webhooks test ${result.subscriptions[0]!.id}`, 'nodium webhooks deliveries --failed']
    : ['nodium webhooks new --url <https://…> --event message.received', 'nodium listen --forward <local url>'])
  return 0
}

async function deliveries(ctx: Ctx): Promise<number> {
  const limit = listLimit(ctx.args)
  const subscriptionId = flag(ctx.args, 'subscription')
  const event = flag(ctx.args, 'event')
  const items = await take(ctx.scope().webhooks.eachDelivery({
    limit: pageSize(limit),
    ...(hasFlag(ctx.args, 'failed') ? { status: 'failed' as const } : {}),
    ...(subscriptionId ? { subscriptionId } : {}), ...(event ? { event } : {})
  }), limit)
  ctx.print(items, () => {
    for (const line of table(items.map(d => [
      when(d.createdAt), d.id, d.event, d.status, d.responseStatus === null ? '—' : String(d.responseStatus), `${d.attempts} attempt${d.attempts === 1 ? '' : 's'}`, d.lastError ?? ''
    ]))) ctx.output.out(line)
  }, items.find(d => d.status === 'failed') ? [`nodium webhooks redeliver ${items.find(d => d.status === 'failed')!.id}`] : [])
  return 0
}

async function create(ctx: Ctx): Promise<number> {
  const url = flag(ctx.args, 'url')
  if (!url) throw new UsageError('--url <https://…> is required: the address Nodium calls.')
  const events = readEvents(flagAll(ctx.args, 'event'))
  if (!events.length) throw new UsageError('Name at least one event: --event message.received (repeat it), or --event "*" for all.')
  const channelIds = flagAll(ctx.args, 'channel')
  const label = flag(ctx.args, 'label')
  await ctx.confirm(`Subscribe ${url} to ${events.join(', ')}`)
  const result = await ctx.scope().webhooks.create({ url, events, ...(channelIds.length ? { channelIds } : {}), ...(label ? { label } : {}) })
  ctx.print(result, () => {
    ctx.output.out(`${paint(ctx.output, 'green', 'Subscribed')}: ${result.id}`)
    printSecret(ctx, result.secret)
  }, [`nodium webhooks test ${result.id}`])
  return 0
}

async function update(ctx: Ctx): Promise<number> {
  const id = ctx.args.positionals[0]!
  const input: WebhookUpdate = {}
  const url = flag(ctx.args, 'url')
  const label = flag(ctx.args, 'label')
  const active = flag(ctx.args, 'active')
  if (url) input.url = url
  if (label !== undefined) input.label = label
  if (hasFlag(ctx.args, 'event')) input.events = readEvents(flagAll(ctx.args, 'event'))
  if (hasFlag(ctx.args, 'channel')) input.channelIds = flagAll(ctx.args, 'channel').filter(Boolean)
  if (active !== undefined) {
    if (active !== 'true' && active !== 'false') throw new UsageError('--active must be true or false.')
    input.isActive = active === 'true'
  }
  if (!Object.keys(input).length) throw new UsageError('Nothing to change: give --url, --event, --channel, --label or --active.')
  await ctx.confirm(`Change webhook ${id} (${Object.keys(input).join(', ')})`)
  const subscription = await ctx.scope().webhooks.update(id, input)
  ctx.print(subscription, () => ctx.output.out(`Saved: ${subscription.id} → ${subscription.url} (${subscription.isActive ? 'active' : 'paused'}).`), [`nodium webhooks test ${subscription.id}`])
  return 0
}

async function remove(ctx: Ctx): Promise<number> {
  const id = ctx.args.positionals[0]!
  await ctx.confirm(`Delete webhook ${id}: Nodium stops calling it`)
  const result = await ctx.scope().webhooks.delete(id)
  ctx.print(result ?? { deleted: true }, () => ctx.output.out(`Webhook ${id} deleted.`), ['nodium webhooks list'])
  return 0
}

async function test(ctx: Ctx): Promise<number> {
  const result = await ctx.scope().webhooks.test(ctx.args.positionals[0]!)
  ctx.print(result, () => {
    ctx.output.out(result.ok
      ? `${paint(ctx.output, 'green', String(result.status))}  answered in ${result.ms} ms.`
      : `${paint(ctx.output, 'red', result.status === null ? 'ERR' : String(result.status))}  ${result.error ?? 'not a 2xx answer'} (${result.ms} ms).`)
  }, result.ok ? ['nodium webhooks deliveries'] : [`nodium webhooks update ${ctx.args.positionals[0]} --url <https://…>`])
  return result.ok ? 0 : 1
}

async function redeliver(ctx: Ctx): Promise<number> {
  const id = ctx.args.positionals[0]!
  await ctx.confirm(`Send delivery ${id} again`)
  const delivery = await ctx.scope().webhooks.redeliver(id)
  ctx.print(delivery, () => ctx.output.out(`Delivery ${delivery.id}: ${delivery.status}${delivery.responseStatus ? ` (${delivery.responseStatus})` : ''}.`), ['nodium webhooks deliveries'])
  return delivery.status === 'failed' ? 1 : 0
}

async function rotateSecret(ctx: Ctx): Promise<number> {
  const id = ctx.args.positionals[0]!
  await ctx.confirm(`Issue a new signing secret for webhook ${id}`)
  const result = await ctx.scope().webhooks.rotateSecret(id)
  ctx.print(result, () => {
    printSecret(ctx, result.secret)
    ctx.output.out(`The old secret still signs until ${when(result.previousValidUntil)}: verify with both meanwhile.`)
  })
  return 0
}

export const WEBHOOK_COMMANDS: Command[] = [
  { path: ['webhooks', 'list'], summary: 'Your subscriptions.', run: list },
  {
    path: ['webhooks', 'deliveries'], summary: 'The latest deliveries, newest first.', flags: ['limit', 'failed', 'subscription', 'event'],
    help: `  --failed               Only the failed ones.
  --subscription <id>    Only for this subscription.
  --event <name>         Only this event.
  --limit <n>            At most n (default 20).`,
    run: deliveries
  },
  {
    path: ['webhooks', 'new'], summary: 'Subscribe an https address to events. Prints the secret once.', flags: ['url', 'event', 'channel', 'label'],
    help: `  --url <https://…>   The address Nodium calls. Required.
  --event <name>      An event (repeat it, or a,b), * for all. Required.
  --channel <id>      Only the events of this number (repeat it). Default: all numbers.
  --label <text>      A name for you.`,
    run: create
  },
  {
    path: ['webhooks', 'update'], args: ['<id>'], summary: 'Change the address, events, numbers, label, or pause it.', flags: ['url', 'event', 'channel', 'label', 'active'],
    help: `  --url, --event, --channel, --label   As for \`webhooks new\`; --event and --channel replace the list.
  --active <true|false>                Resume or pause it.`,
    run: update
  },
  { path: ['webhooks', 'delete'], args: ['<id>'], summary: 'Delete a subscription.', run: remove },
  { path: ['webhooks', 'test'], args: ['<id>'], summary: 'Call the address once with a test event.', run: test },
  { path: ['webhooks', 'redeliver'], args: ['<deliveryId>'], summary: 'Send a delivery again.', run: redeliver },
  { path: ['webhooks', 'rotate-secret'], args: ['<id>'], summary: 'A new signing secret; the old one still works for a while.', run: rotateSecret }
]
