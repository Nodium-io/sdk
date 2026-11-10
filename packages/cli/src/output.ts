import { NodiumError } from '@nodium.io/whatsapp'
import { UsageError } from './args'

/**
 * Ce que la commande écrit : une ligne à la fois, en couleur seulement devant
 * un terminal (`NO_COLOR` et `--no-color` l'éteignent).
 */
export interface Output {
  /** Une ligne sur la sortie standard. */
  out(text: string): void
  /** Une ligne sur la sortie d'erreur. */
  err(text: string): void
  /** Vrai : les couleurs ANSI sont permises. */
  color: boolean
}

const CODES = { dim: 2, red: 31, green: 32, yellow: 33, cyan: 36, bold: 1 } as const

export function paint(output: Pick<Output, 'color'>, style: keyof typeof CODES, text: string): string {
  return output.color ? `\u001b[${CODES[style]}m${text}\u001b[0m` : text
}

/** Le bloc « Next: » : les commandes à lancer ensuite, une par ligne. */
export function printNext(output: Output, steps: readonly string[] | undefined): void {
  if (!steps?.length) return
  output.out('')
  output.out('Next:')
  for (const step of steps) output.out(`  ${step}`)
}

/** L'heure locale, `HH:MM:SS`. */
export function clock(date = new Date()): string {
  return date.toTimeString().slice(0, 8)
}

/** Les codes qui n'ont pas de ligne dans le guide des erreurs. */
const NO_GUIDE = new Set(['unknown_error', 'network_error', 'timeout'])

/**
 * Une erreur en quelques lignes : le statut et le `code` (stable, c'est lui
 * qu'on cherche dans la documentation), le texte, l'identifiant à donner au
 * support, et la ligne du guide des erreurs.
 */
export function describeError(error: unknown, baseUrl: string): string {
  if (error instanceof UsageError) return error.message
  if (!(error instanceof NodiumError)) return error instanceof Error ? error.message : String(error)

  const lines = [`${error.status ? `Error ${error.status}` : 'Error'} ${error.code}: ${error.message}`]
  if (error.status === 401) lines.push('The key is missing, malformed, expired or revoked: check --key, NODIUM_KEY, or run `nodium login` again.')
  if (error.retryAfter !== null) lines.push(`Retry in ${error.retryAfter} s.`)
  if (error.requestId) lines.push(`Request id: ${error.requestId}`)
  if (error.status > 0 && !NO_GUIDE.has(error.code)) {
    try {
      lines.push(`More: ${new URL(baseUrl).origin}/en/docs/api/guide/responses#${error.code}`)
    } catch { /* adresse illisible : pas de lien */ }
  }
  return lines.join('\n')
}

/**
 * Le refus en JSON, sur la sortie d'erreur : `{ "error": { status, code,
 * message, requestId } }`. Une faute d'usage a `status` 0 et le code `usage_error`.
 */
export function errorJson(error: unknown): string {
  const body = error instanceof NodiumError
    ? { status: error.status, code: error.code, message: error.message, requestId: error.requestId }
    : { status: 0, code: error instanceof UsageError ? 'usage_error' : 'cli_error', message: error instanceof Error ? error.message : String(error), requestId: null }
  return JSON.stringify({ error: body }, null, 2)
}

/** Des colonnes alignées, une ligne par entrée ; la dernière colonne n'est pas complétée. */
export function table(rows: ReadonlyArray<ReadonlyArray<string>>): string[] {
  const widths: number[] = []
  for (const row of rows) row.forEach((cell, i) => { widths[i] = Math.max(widths[i] ?? 0, cell.length) })
  return rows.map(row => row.map((cell, i) => (i === row.length - 1 ? cell : cell.padEnd(widths[i]!))).join('  ').trimEnd())
}

/** Une date ISO en `AAAA-MM-JJ HH:MM`, ou `—`. */
export function when(iso: string | null | undefined): string {
  return iso ? iso.slice(0, 16).replace('T', ' ') : '—'
}

/** Un objet en lignes `clé  valeur` ; ce qui est imbriqué s'écrit en JSON compact. */
export function details(object: object): string[] {
  return table(Object.entries(object).map(([key, value]) => [
    key,
    value === null || value === undefined ? '—' : typeof value === 'object' ? JSON.stringify(value) : String(value)
  ]))
}
