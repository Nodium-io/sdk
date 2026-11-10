import { hasFlag } from '../args'
import type { Command, Ctx } from '../context'
import { details, paint, table } from '../output'
import { numberState } from './account'

/**
 * Les numéros WhatsApp branchés (les canaux) : les lister, en lire un (et
 * dire s'il n'a encore rien reçu), demander à Meta comment il se porte.
 */

async function list(ctx: Ctx): Promise<number> {
  const numbers = await ctx.scope().channels.list(hasFlag(ctx.args, 'all') ? { scope: 'account' } : {})
  ctx.print(numbers, () => {
    if (!numbers.length) ctx.output.out('No number connected.')
    for (const line of table(numbers.map(n => [n.id, n.identity, n.name, numberState(n) + (n.isTest ? ' · sandbox' : '')]))) ctx.output.out(line)
  }, numbers.length
    ? [`nodium numbers check ${numbers[0]!.id}`, `nodium send --channel ${numbers[0]!.id} --to <+33…> --text "Hello"`]
    : ['nodium connect-link new --tenant <id>'])
  return 0
}

async function get(ctx: Ctx): Promise<number> {
  const number = await ctx.scope().channels.get(ctx.args.positionals[0]!)
  ctx.print(number, () => {
    details(number).forEach(line => ctx.output.out(line))
    // Un numéro branché qui n'a encore rien reçu : la preuve se fait d'un autre téléphone.
    if (!number.lastInboundAt && !number.isTest) {
      ctx.output.out(paint(ctx.output, 'dim', `No message received yet: send "Hello" to ${number.displayPhone ?? number.identity} from another phone.`))
    }
  }, [`nodium numbers check ${number.id}`, `nodium send --channel ${number.id} --to <+33…> --text "Hello"`])
  return 0
}

async function check(ctx: Ctx): Promise<number> {
  const result = await ctx.scope().channels.check(ctx.args.positionals[0]!) as { ok?: boolean, message?: string, reason?: string, number?: object }
  ctx.print(result, () => {
    ctx.output.out(paint(ctx.output, result.ok ? 'green' : 'red', result.ok ? 'Meta answers for this number.' : `Not reachable${result.reason ? ` (${result.reason})` : ''}.`))
    if (result.message) ctx.output.out(result.message)
    if (result.number) details(result.number).forEach(line => ctx.output.out(`  ${line}`))
  }, result.ok ? [`nodium send --channel ${ctx.args.positionals[0]} --to <+33…> --text "Hello"`] : ['nodium health'])
  return result.ok ? 0 : 1
}

/**
 * Le diagnostic d'un numéro : chaque contrôle, qui peut le régler et quoi
 * faire. Code de sortie 1 quand un contrôle échoue.
 */
async function diagnose(ctx: Ctx): Promise<number> {
  const result = await ctx.scope().channels.diagnostic(ctx.args.positionals[0]!)
  const COLOR = { ok: 'green', warn: 'yellow', fail: 'red', skip: 'dim' } as const
  ctx.print(result, () => {
    for (const item of result.checks) {
      ctx.output.out(`${paint(ctx.output, COLOR[item.status], item.status.padEnd(4))}  ${item.check.padEnd(10)} ${item.message}`)
      if (item.action) ctx.output.out(`      ${paint(ctx.output, 'dim', `${item.actor === 'none' ? '' : `${item.actor}: `}${item.action}`)}`)
    }
  }, result.verdict === 'ok' ? [`nodium numbers get ${ctx.args.positionals[0]}`] : ['nodium logs --errors'])
  return result.verdict === 'fail' ? 1 : 0
}

export const NUMBER_COMMANDS: Command[] = [
  {
    path: ['numbers', 'list'], summary: 'Your connected WhatsApp numbers and their state.', flags: ['all'],
    help: '  --all   The numbers of every client of the account (a key that is not pinned).',
    run: list
  },
  { path: ['numbers', 'get'], args: ['<id>'], summary: 'One number: quality, messaging limit, last health check.', run: get },
  { path: ['numbers', 'check'], args: ['<id>'], summary: 'Ask Meta now whether the number works. Exit code 1 if not.', run: check },
  { path: ['numbers', 'diagnose'], args: ['<id>'], summary: 'Why a number does not send or receive: each check, who fixes it, what to do. Exit 1 on a failure.', run: diagnose }
]
