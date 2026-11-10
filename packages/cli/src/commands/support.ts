import { flag, hasFlag } from '../args'
import { listLimit, pageSize, take, type Command, type Ctx } from '../context'
import { paint, table } from '../output'

/**
 * Dépanner : les derniers appels à l'API et leurs erreurs (`logs`), les
 * envois livrés, lus ou en échec (`stats`), le numéro d'essai partagé
 * (`sandbox`). Rien n'y écrit.
 */

async function logs(ctx: Ctx): Promise<number> {
  const limit = listLimit(ctx.args)
  const items = await take(ctx.scope().apiRequests.each({ limit: pageSize(limit), ...(hasFlag(ctx.args, 'errors') ? { errorsOnly: true } : {}) }), limit)
  ctx.print(items, () => {
    if (!items.length) ctx.output.out('No call in the last 30 days.')
    for (const line of table(items.map(call => [
      call.createdAt.slice(0, 19).replace('T', ' '),
      paint(ctx.output, call.status >= 400 ? 'red' : 'green', String(call.status)),
      `${call.method} ${call.path}`,
      call.errorCode ?? '',
      `${call.durationMs} ms`
    ]))) ctx.output.out(line)
  }, items.some(call => call.status >= 400) ? ['nodium health'] : [])
  return 0
}

async function stats(ctx: Ctx): Promise<number> {
  const rawSource = flag(ctx.args, 'source')
  const source = rawSource === 'broadcast' ? 'broadcast' : 'template'
  const result = await ctx.scope().stats.delivery({ source, ...(flag(ctx.args, 'channel') ? { channelId: flag(ctx.args, 'channel') } : {}) })
  const rate = (part: number) => (result.totals.sent ? `${Math.round((part / result.totals.sent) * 100)} %` : '—')
  ctx.print(result, () => {
    ctx.output.out(`From ${result.from.slice(0, 10)} to ${result.to.slice(0, 10)}, ${source === 'broadcast' ? 'broadcasts' : 'templates'}:`)
    for (const line of table([
      ['Sent', String(result.totals.sent), ''],
      ['Delivered', String(result.totals.delivered), rate(result.totals.delivered)],
      ['Read', String(result.totals.read), rate(result.totals.read)],
      ['Replied', String(result.totals.replied), rate(result.totals.replied)],
      ['Failed', String(result.totals.failed), rate(result.totals.failed)]
    ])) ctx.output.out(`  ${line}`)
  }, result.totals.failed ? ['nodium logs --errors'] : [])
  return 0
}

async function sandbox(ctx: Ctx): Promise<number> {
  const state = await ctx.nodium().sandbox.get()
  ctx.print(state, () => {
    if (!state.available) {
      ctx.output.out('The sandbox is closed on this server.')
      return
    }
    ctx.output.out(`Test number: ${paint(ctx.output, 'bold', state.displayPhone ?? '')}`)
    ctx.output.out(`From your phone, send: ${paint(ctx.output, 'bold', state.joinMessage ?? '')}`)
    if (state.waLink) ctx.output.out(`Or open: ${state.waLink}`)
    ctx.output.out(`Linked phones: ${state.linkedPhones.length}${state.limits ? ` of ${state.limits.maxPhones}` : ''}`)
  }, state.channelId ? [`nodium send --channel ${state.channelId} --to <your phone> --text "Hello"`] : [])
  return 0
}

export const SUPPORT_COMMANDS: Command[] = [
  {
    path: ['logs'], summary: 'The latest calls made with your keys, and why they failed.', flags: ['errors', 'limit'],
    help: `  --errors      Only calls that did not succeed (status 400 and above).
  --limit <n>   At most n (default 20).

Calls of the last 30 days, newest first. With --tenant, only the calls made on that client.`,
    run: logs
  },
  {
    path: ['stats'], summary: 'Messages sent, delivered, read, replied and failed over 30 days.', flags: ['source', 'channel'],
    help: `  --source <s>     template (default) or broadcast.
  --channel <id>   Only this number.`,
    run: stats
  },
  { path: ['sandbox'], summary: 'The shared test number, and how to link your phone to it.', run: sandbox }
]
