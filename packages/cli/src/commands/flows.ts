import { readFileSync } from 'node:fs'
import { basename, extname } from 'node:path'
import type { FlowValidationError } from '@nodium.io/whatsapp'
import { UsageError, flag, hasFlag } from '../args'
import type { Command, Ctx } from '../context'
import { parseJsonObject } from '../input'
import { paint } from '../output'

/**
 * `nodium flows deploy <file.json>` : un Flow écrit en local part chez Meta —
 * un nouveau brouillon, ou une version de plus d'un brouillon (`--id`). Meta
 * valide le JSON ; ses erreurs s'affichent. `--publish` publie ensuite, et
 * seulement si Meta n'a rien trouvé.
 *
 * ⚠️ Publier est définitif : un Flow publié ne se modifie plus.
 */

/** Une erreur de Meta sur une ligne : où, et quoi. */
export function describeFlowError(error: FlowValidationError): string {
  const where = error.line_start !== undefined ? `line ${error.line_start}${error.column_start !== undefined ? `:${error.column_start}` : ''}  ` : ''
  return `${where}${error.error}: ${error.message}`
}

async function deploy(ctx: Ctx): Promise<number> {
  const file = ctx.args.positionals[0]!
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch (error: any) {
    throw new UsageError(`Cannot read ${file}: ${error?.code === 'ENOENT' ? 'no such file' : error?.message ?? error}.`)
  }
  const flowJson = parseJsonObject(text, file)
  const id = flag(ctx.args, 'id')
  const publish = hasFlag(ctx.args, 'publish')
  if (id && flag(ctx.args, 'name')) throw new UsageError('--name is for a new Flow; to rename one, use the console.')

  const flows = ctx.scope().flows
  await ctx.confirm(`${id ? `Save a new version of Flow ${id}` : 'Create a Flow'} at Meta from ${file}${publish ? ', then publish it (final)' : ''}`)
  const saved = id
    ? { flow: null, ...(await flows.saveVersion(id, flowJson)) }
    : await flows.create({ name: flag(ctx.args, 'name') ?? basename(file, extname(file)), flowJson })
  const flowId = saved.flow?.id ?? id!
  const errors = saved.validationErrors
  const published = publish && !errors.length ? await flows.publish(flowId) : null

  ctx.print({ flowId, version: saved.version, validationErrors: errors, published }, () => {
    const { out, err } = ctx.output
    out(`${paint(ctx.output, 'green', 'Saved')}: Flow ${flowId}, version ${saved.version.label}.`)
    if (errors.length) {
      err(paint(ctx.output, 'red', `Meta found ${errors.length} problem${errors.length === 1 ? '' : 's'}:`))
      for (const e of errors) err(`  ${describeFlowError(e)}`)
      if (publish) err('Not published: fix the file and deploy again.')
    } else if (published) {
      out(`${paint(ctx.output, 'green', 'Published')}: ${published.name} can now be sent.`)
    } else {
      out('Valid.')
    }
  }, errors.length
    ? [`nodium flows deploy ${file} --id ${flowId}`]
    : published ? [] : [`nodium flows deploy ${file} --id ${flowId} --publish`])
  return errors.length ? 1 : 0
}

export const FLOW_COMMANDS: Command[] = [
  {
    path: ['flows', 'deploy'], args: ['<file.json>'], summary: 'Send a local Flow JSON to Meta, as a new draft or a new version.',
    flags: ['name', 'id', 'publish'],
    help: `  --id <flowId>   Save a new version of this draft Flow. Without it: a new Flow.
  --name <text>   The new Flow's name. Default: the file name.
  --publish       Publish it once Meta finds no problem. Final: a published Flow cannot change.

Meta's validation problems are printed, with their line; exit code 1 if there are any.`,
    run: deploy
  }
]
