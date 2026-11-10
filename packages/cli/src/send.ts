import type { SendInput } from '@nodium.io/whatsapp'
import { UsageError, flag, flagAll, hasFlag, type ParsedArgs } from './args'
import type { Command, Ctx } from './context'
import { readJsonInput } from './input'
import { paint } from './output'

/**
 * `nodium send` : un message. Du texte libre (dans les 24 h qui suivent le
 * dernier message de la personne) ou un modèle approuvé (le seul envoi
 * possible pour écrire en premier) par drapeaux ; tout autre message (fichier,
 * boutons, liste…) en JSON, par `--input` ou `--stdin`.
 *
 * ⚠️ Un envoi refusé par Meta répond HTTP 200 : la commande lit
 *    `message.status` et sort en erreur (code 1) quand il vaut `failed`.
 */

/** Ce que la commande a lu de la ligne de commande, vérifié. */
export function readSendInput(args: ParsedArgs): SendInput {
  const channelId = flag(args, 'channel')
  if (!channelId) throw new UsageError('--channel <id> is required: the number to send from (`GET /channels`).')

  const to = flag(args, 'to')
  const recipient = flag(args, 'recipient')
  if (!to && !recipient) throw new UsageError('--to <+33612345678> is required (or --recipient wa:… for a contact without a number).')
  if (to && recipient) throw new UsageError('Give --to or --recipient, never both.')
  const address = to ? { to } : { recipient: recipient! }

  const text = flag(args, 'text')
  const template = flag(args, 'template')
  if (text !== undefined && template) throw new UsageError('Give --text or --template, not both.')
  if (text === undefined && !template) throw new UsageError('Nothing to send: give --text "…" or --template <name>.')

  const idempotencyKey = flag(args, 'idempotency-key')
  const base = { channelId, ...(idempotencyKey ? { idempotencyKey } : {}) }

  if (text !== undefined) return { ...base, ...address, type: 'text', text }

  const variables: Record<string, string> = {}
  for (const pair of flagAll(args, 'var')) {
    const eq = pair.indexOf('=')
    if (eq <= 0) throw new UsageError(`--var "${pair}" must look like 1=Karim (the number of the {{variable}}, then its value).`)
    variables[pair.slice(0, eq)] = pair.slice(eq + 1)
  }
  const language = flag(args, 'language')
  return {
    ...base, ...address, type: 'template', templateName: template!,
    ...(language ? { templateLanguage: language } : {}),
    ...(Object.keys(variables).length ? { variables } : {})
  }
}

/** Les drapeaux qui décrivent le message ; avec `--input` ou `--stdin`, aucun ne se donne. */
const MESSAGE_FLAGS = ['channel', 'to', 'recipient', 'text', 'template', 'language', 'var', 'idempotency-key']

/** Le message à envoyer : le JSON de `--input`/`--stdin` (un `SendInput`), sinon les drapeaux. */
async function readMessage(ctx: Ctx): Promise<SendInput> {
  const json = await readJsonInput(ctx)
  if (!json) return readSendInput(ctx.args)
  const mixed = MESSAGE_FLAGS.find(name => hasFlag(ctx.args, name))
  if (mixed) throw new UsageError(`--${mixed} cannot be mixed with --input or --stdin: put everything in the JSON.`)
  if (typeof json.channelId !== 'string' || (typeof json.to !== 'string' && typeof json.recipient !== 'string')) {
    throw new UsageError('The JSON needs "channelId" and "to" (or "recipient"), plus "type" and its fields.')
  }
  return json as unknown as SendInput
}

/** Envoie, écrit le résultat, rend le code de sortie. */
async function send(ctx: Ctx): Promise<number> {
  const input = await readMessage(ctx)
  const target = input.to ?? input.recipient
  await ctx.confirm(`Send a ${input.type ?? 'message'} to ${target} from number ${input.channelId}`)
  const result = await ctx.scope().messages.send(input)
  const message = result.message
  const failed = message?.status === 'failed'
  ctx.print(result, () => {
    const { output } = ctx
    if (!message) return output.out(`Sent to ${target}.`)
    if (failed) {
      output.err(paint(output, 'red', `Message ${message.id} to ${target} failed.`))
      if (message.errorInfo) {
        output.err(`${message.errorInfo.title}`)
        output.err(`What to do (${message.errorInfo.actor}): ${message.errorInfo.action}`)
      } else if (message.error) {
        output.err(message.error)
      }
      return
    }
    output.out(`${paint(output, 'green', message.status)}  message ${message.id} to ${target}${result.duplicate ? ' (already sent with this idempotency key: nothing left again)' : ''}`)
  }, message ? [`nodium messages get ${message.id}`] : [])
  return failed ? 1 : 0
}

export const SEND_COMMAND: Command = {
  path: ['send'], summary: 'Send a WhatsApp message. Asks first.',
  flags: [...MESSAGE_FLAGS, 'input', 'stdin'],
  help: `  --channel <id>          The number to send from (\`nodium numbers list\`). Required.
  --to <number>           The recipient, in international format. Or --recipient wa:… for a
                          contact who shows no number.
  --text <text>           Free text: only within 24 hours of the person's last message.
  --template <name>       An approved template: the only way to write first.
  --language <code>       The template language, for example en or fr.
  --var <n=value>         A template variable (repeat it): --var 1=Karim --var 2=Friday.
  --idempotency-key <k>   Your own anti-duplicate key (8 to 200 characters).
  --input <file.json>     Any message as JSON (image, buttons, list, location…), or --stdin.
                          The fields of POST /messages: channelId, to, type and its fields.

Examples
  nodium send --channel <id> --to +33612345678 --text "Hello"
  nodium send --channel <id> --to +33612345678 --template order_ready --language en --var 1=Karim
  echo '{"channelId":"<id>","to":"+33612345678","type":"image","mediaId":"<id>"}' | nodium send --stdin --yes

A send Meta refuses answers HTTP 200: the command reads the message status and exits 1.`,
  run: send
}
