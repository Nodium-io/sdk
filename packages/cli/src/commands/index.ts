import { flag, hasFlag, readInteger } from '../args'
import type { Command, Ctx } from '../context'
import { DEFAULT_INTERVAL_MS, listen, parseEventFilter, parseForwardUrl } from '../listen'
import { SEND_COMMAND } from '../send'
import { ACCOUNT_COMMANDS } from './account'
import { CONVERSATION_COMMANDS } from './conversations'
import { FLOW_COMMANDS } from './flows'
import { NUMBER_COMMANDS } from './numbers'
import { SUPPORT_COMMANDS } from './support'
import { TEMPLATE_COMMANDS } from './templates'
import { TENANT_COMMANDS } from './tenants'
import { WEBHOOK_COMMANDS } from './webhooks'

/**
 * LA TABLE DES COMMANDES — un nom (`templates`), au besoin un verbe (`wait`) :
 * l'aide, les drapeaux permis et ce que fait chacune vivent ensemble, ici et
 * dans `commands/*.ts`. `run.ts` ne fait que chercher dans cette table.
 */

async function runListen(ctx: Ctx): Promise<number> {
  const forward = parseForwardUrl(flag(ctx.args, 'forward'))
  const events = parseEventFilter(flag(ctx.args, 'events'))
  const summary = await listen({
    scope: ctx.scope(), baseUrl: ctx.baseUrl, forward, events,
    secret: flag(ctx.args, 'secret') ?? ctx.env.NODIUM_WEBHOOK_SECRET ?? null,
    from: readInteger(ctx.args, 'from', 0),
    intervalMs: readInteger(ctx.args, 'interval', 1) ?? DEFAULT_INTERVAL_MS,
    verbose: hasFlag(ctx.args, 'verbose'),
    signal: ctx.signal,
    output: ctx.output,
    ...(ctx.fetch ? { fetch: ctx.fetch } : {})
  })
  ctx.output.out(`Stopped. ${summary.forwarded} forwarded, ${summary.failed} not answered with a 2xx. Resume with --from ${summary.after}.`)
  return 0
}

const LISTEN_COMMAND: Command = {
  path: ['listen'], summary: 'Replay your events to a local URL, signed like production: no tunnel.',
  flags: ['forward', 'secret', 'events', 'from', 'interval', 'verbose'],
  help: `  --forward <url>    Your local address, for example http://localhost:3000/webhook. Required.
  --secret <whsec>   Signs each call with X-Nodium-Signature (t=…,v1=…), as in production.
                     Use the secret of your webhook subscription, or any string your code also
                     uses to verify: the signature is computed here. Default: $NODIUM_WEBHOOK_SECRET.
  --events <a,b>     Only these events (message.received,message.failed…). Default: all.
  --from <seq>       Start after this event number (the "Resume with" line printed on exit).
                     Default: from now.
  --interval <ms>    Wait between two reads when nothing is new. Default: ${DEFAULT_INTERVAL_MS}.
  --verbose          Also print each event's data.

It reads the event log (GET /events). Events of every client of the account arrive,
unless --tenant names one or the key is pinned to one. A call your server answers with
a non-2xx status, or not at all, is shown and not retried. It prints lines as they come,
whatever --output says.`,
  run: runListen
}

export const COMMANDS: Command[] = [
  ...ACCOUNT_COMMANDS, SEND_COMMAND, LISTEN_COMMAND,
  ...NUMBER_COMMANDS, ...CONVERSATION_COMMANDS, ...TEMPLATE_COMMANDS, ...WEBHOOK_COMMANDS, ...TENANT_COMMANDS, ...FLOW_COMMANDS,
  ...SUPPORT_COMMANDS
]

/** Les commandes dont le chemin commence par ces mots. */
export function findCommands(words: readonly string[]): Command[] {
  return COMMANDS.filter(c => words.every((w, i) => c.path[i] === w))
}
