import { readFileSync } from 'node:fs'
import { UsageError, flag, hasFlag } from './args'
import type { Ctx } from './context'

/**
 * Un corps JSON donné à une commande : `--input <fichier.json>` ou `--stdin`.
 * `null` quand aucun des deux n'est donné.
 */
export async function readJsonInput(ctx: Ctx): Promise<Record<string, unknown> | null> {
  const file = flag(ctx.args, 'input')
  const stdin = hasFlag(ctx.args, 'stdin')
  if (file && stdin) throw new UsageError('Give --input <file> or --stdin, not both.')
  if (!file && !stdin) return null
  let text: string
  if (file) {
    try {
      text = readFileSync(file, 'utf8')
    } catch (error: any) {
      throw new UsageError(`Cannot read ${file}: ${error?.code === 'ENOENT' ? 'no such file' : error?.message ?? error}.`)
    }
  } else {
    text = await ctx.io.readStdin()
  }
  return parseJsonObject(text, file ?? 'stdin')
}

export function parseJsonObject(text: string, where: string): Record<string, unknown> {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (error) {
    throw new UsageError(`${where} is not valid JSON: ${error instanceof Error ? error.message : error}`)
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new UsageError(`${where} must hold one JSON object.`)
  return value as Record<string, unknown>
}
