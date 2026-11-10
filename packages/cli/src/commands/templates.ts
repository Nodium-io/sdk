import type { TemplateInput, TemplateUpdate } from '@nodium.io/whatsapp'
import { UsageError, flag, hasFlag } from '../args'
import type { Command, Ctx } from '../context'
import { readJsonInput } from '../input'
import { details, paint, table, when } from '../output'

/**
 * Les modèles : un brouillon s'écrit dans Nodium (`new`, `update`), part chez
 * Meta par `deploy`, puis Meta le revoit ; `wait` attend son verdict.
 *
 * ⚠️ `deploy` est définitif côté Meta : le nom y est réservé. La commande
 *    demande l'accord avant.
 */

/** Où en est un modèle, compte WhatsApp par compte WhatsApp. */
export type TemplateOutcome = 'approved' | 'refused' | 'pending' | 'not_deployed'

/** Les états d'où Meta ne revient pas seul : il faut corriger, puis redéployer. */
const REFUSED = new Set(['rejected', 'paused', 'disabled', 'failed'])

/** Le verdict d'ensemble : approuvé partout, refusé quelque part, en revue, ou pas déployé. */
export function templateOutcome(deployments: ReadonlyArray<{ status: string }>): TemplateOutcome {
  if (!deployments.length) return 'not_deployed'
  if (deployments.some(d => REFUSED.has(d.status))) return 'refused'
  if (deployments.some(d => d.status === 'not_deployed' || d.status === 'no_number')) return 'not_deployed'
  if (deployments.every(d => d.status === 'approved')) return 'approved'
  return 'pending'
}

/** `10m`, `90s`, `1h`, ou un nombre de secondes → millisecondes. */
export function parseDuration(text: string): number {
  const match = /^(\d+)\s*(s|m|h)?$/.exec(text.trim())
  if (!match) throw new UsageError(`--timeout "${text}" must look like 90s, 10m or 1h.`)
  return Number(match[1]) * { s: 1000, m: 60_000, h: 3_600_000 }[(match[2] ?? 's') as 's' | 'm' | 'h']
}

/** L'attente entre deux questions à Meta. */
export const WAIT_INTERVAL_MS = 15_000

/** Ce qui suit un modèle, d'après son verdict chez Meta. */
function templateNext(id: string, name: string, outcome: ReturnType<typeof templateOutcome>): string[] {
  if (outcome === 'approved') return [`nodium send --channel <id> --to <+33…> --template ${name} --language <code>`]
  if (outcome === 'not_deployed') return [`nodium templates deploy ${id}`]
  if (outcome === 'pending') return [`nodium templates wait ${id}`]
  return [`nodium templates update ${id} --input <file.json>`, `nodium templates deploy ${id}`]
}

async function list(ctx: Ctx): Promise<number> {
  const result = await ctx.scope().templates.list(hasFlag(ctx.args, 'all') ? { scope: 'account' } : {})
  ctx.print(result, () => {
    for (const line of table(result.templates.map(t => [t.id, t.name, t.language, t.category.toLowerCase(), t.status]))) ctx.output.out(line)
    ctx.output.out(paint(ctx.output, 'dim', `${result.summary.total} templates: ${result.summary.deployed} deployed, ${result.summary.draft} drafts.`))
  }, result.templates.length ? [`nodium templates get ${result.templates[0]!.id}`] : ['nodium templates new --input <file.json>'])
  return 0
}

async function get(ctx: Ctx): Promise<number> {
  const result = await ctx.scope().templates.get(ctx.args.positionals[0]!)
  ctx.print(result, () => {
    details(result.template).forEach(line => ctx.output.out(line))
    if (result.deployments.length) ctx.output.out(paint(ctx.output, 'bold', 'At Meta'))
    for (const line of table(result.deployments.map(d => [d.wabaId ?? '—', d.status, d.rejectionReason ?? '', when(d.reviewedAt)]))) ctx.output.out(`  ${line}`)
  }, templateNext(result.template.id, result.template.name, templateOutcome(result.deployments)))
  return 0
}

async function requireInput(ctx: Ctx): Promise<Record<string, unknown>> {
  const input = await readJsonInput(ctx)
  if (!input) throw new UsageError('Give the template as JSON: --input <file.json> or --stdin. See `nodium help templates new`.')
  return input
}

async function create(ctx: Ctx): Promise<number> {
  const result = await ctx.scope().templates.create(await requireInput(ctx) as unknown as TemplateInput)
  ctx.print(result, () => {
    ctx.output.out(`${paint(ctx.output, 'green', 'Draft saved')}: ${result.template.name} (${result.template.id}). Nothing went to Meta yet.`)
  }, [`nodium templates deploy ${result.template.id}`])
  return 0
}

async function update(ctx: Ctx): Promise<number> {
  const result = await ctx.scope().templates.update(ctx.args.positionals[0]!, await requireInput(ctx) as unknown as TemplateUpdate)
  ctx.print(result, () => ctx.output.out(`Saved: ${result.template.name} (${result.template.status}).`), [`nodium templates deploy ${result.template.id}`])
  return 0
}

async function deploy(ctx: Ctx): Promise<number> {
  const id = ctx.args.positionals[0]!
  await ctx.confirm(`Submit template ${id} to Meta for review (its name is then reserved there)`)
  const result = await ctx.scope().templates.deploy(id)
  const refused = result.results.some(r => REFUSED.has(r.status))
  ctx.print(result, () => {
    for (const line of table(result.results.map(r => [r.clientName, r.wabaId ?? '—', r.status, r.reason ?? '']))) ctx.output.out(line)
  }, refused ? [`nodium templates update ${id} --input <file.json>`] : [`nodium templates wait ${id}`])
  return refused ? 1 : 0
}

async function refresh(ctx: Ctx): Promise<number> {
  const result = await ctx.scope().templates.refresh(ctx.args.positionals[0]!)
  ctx.print(result, () => ctx.output.out(`${result.template.name}: ${result.template.status} (${result.changed} changed).`), [`nodium templates get ${result.template.id}`])
  return 0
}

/** Les modèles déjà créés chez Meta, rapatriés dans Nodium (ceux du client, ou de tous avec `--all`). */
async function importFromMeta(ctx: Ctx): Promise<number> {
  await ctx.confirm(hasFlag(ctx.args, 'all') ? 'Import the Meta templates of every client' : 'Import the Meta templates of this client')
  const result = await ctx.scope().templates.import(hasFlag(ctx.args, 'all') ? { scope: 'account' } : {})
  ctx.print(result, () => {
    ctx.output.out(`${paint(ctx.output, 'green', 'Imported')}: ${result.count} template${result.count === 1 ? '' : 's'}.`)
    for (const skip of result.skipped) ctx.output.out(`  skipped ${skip.client}: ${skip.reason}`)
  }, ['nodium templates list'])
  return 0
}

async function remove(ctx: Ctx): Promise<number> {
  const id = ctx.args.positionals[0]!
  await ctx.confirm(`Delete template ${id}`)
  const result = await ctx.scope().templates.delete(id)
  ctx.print(result, () => ctx.output.out(result.deleted ? `Template ${id} deleted.` : `Template ${id} was not deleted.`), ['nodium templates list'])
  return result.deleted ? 0 : 1
}

async function wait(ctx: Ctx): Promise<number> {
  const id = ctx.args.positionals[0]!
  const timeout = parseDuration(flag(ctx.args, 'timeout') ?? '10m')
  const deadline = Date.now() + timeout
  const templates = ctx.scope().templates
  for (;;) {
    await templates.refresh(id)
    const detail = await templates.get(id)
    const outcome = templateOutcome(detail.deployments)
    if (outcome !== 'pending' || Date.now() + WAIT_INTERVAL_MS > deadline || ctx.signal.aborted) {
      ctx.print({ outcome: outcome === 'pending' ? 'timeout' : outcome, template: detail.template, deployments: detail.deployments }, () => {
        const { out, err } = ctx.output
        if (outcome === 'approved') out(paint(ctx.output, 'green', `${detail.template.name} is approved: it can be sent.`))
        else if (outcome === 'not_deployed') err(`${detail.template.name} is not at Meta yet: run \`nodium templates deploy ${id}\` first.`)
        else if (outcome === 'pending') err(`Still in review at Meta after ${Math.round(timeout / 1000)} s. Run the command again later.`)
        else {
          err(paint(ctx.output, 'red', `${detail.template.name} was not approved.`))
          for (const d of detail.deployments.filter(d => REFUSED.has(d.status))) err(`  ${d.wabaId ?? '—'}  ${d.status}  ${d.rejectionReason ?? ''}`)
        }
      }, templateNext(id, detail.template.name, outcome))
      return outcome === 'approved' ? 0 : 1
    }
    if (!ctx.json) ctx.output.err(paint(ctx.output, 'dim', `In review at Meta… checking again in ${WAIT_INTERVAL_MS / 1000} s.`))
    await ctx.sleep(WAIT_INTERVAL_MS, ctx.signal)
  }
}

const INPUT_HELP = `  --input <file.json>   The template as JSON, or --stdin to read it from a pipe.`

export const TEMPLATE_COMMANDS: Command[] = [
  {
    path: ['templates', 'list'], summary: 'Your templates and their state at Meta.', flags: ['all'],
    help: '  --all   The templates of every client of the account.', run: list
  },
  { path: ['templates', 'get'], args: ['<id>'], summary: 'One template, and its review at Meta.', run: get },
  {
    path: ['templates', 'new'], summary: 'Save a draft template (nothing goes to Meta yet).', flags: ['input', 'stdin'],
    help: `${INPUT_HELP}

Example file:
  { "name": "order_ready", "language": "en", "category": "UTILITY",
    "body": "Hello {{1}}, your order is ready." }`,
    run: create
  },
  { path: ['templates', 'update'], args: ['<id>'], summary: 'Change a draft, or a template Meta refused.', flags: ['input', 'stdin'], help: INPUT_HELP, run: update },
  { path: ['templates', 'deploy'], args: ['<id>'], summary: 'Submit it to Meta for review. Asks first.', run: deploy },
  { path: ['templates', 'refresh'], args: ['<id>'], summary: 'Ask Meta where the review is.', run: refresh },
  {
    path: ['templates', 'wait'], args: ['<id>'], summary: 'Wait for Meta\'s verdict. Exit 0 approved, 1 refused or timed out.', flags: ['timeout'],
    help: `  --timeout <time>   How long to wait: 90s, 10m, 1h. Default: 10m.

It asks Meta every ${WAIT_INTERVAL_MS / 1000} s until every WhatsApp account approved it, or one
rejected, paused or disabled it.`,
    run: wait
  },
  {
    path: ['templates', 'import'], summary: 'Bring in the templates already created at Meta. Asks first.', flags: ['all'],
    help: '  --all   For every client of the account.', run: importFromMeta
  },
  { path: ['templates', 'delete'], args: ['<id>'], summary: 'Delete a template. Asks first.', run: remove }
]
