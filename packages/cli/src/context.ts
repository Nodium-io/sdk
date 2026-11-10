import type { Nodium, TenantScope } from '@nodium.io/whatsapp'
import { UsageError, readInteger, type ParsedArgs } from './args'
import type { StoredConfig } from './config'
import type { Output } from './output'

/**
 * Ce que reçoit chaque commande : ses arguments, la sortie, le client déjà
 * branché, et les deux règles communes — le format de sortie et l'accord
 * avant une écriture.
 */

/** Les échanges avec la personne au terminal ; remplacés dans les tests. */
export interface Io {
  /** Pose une question sur la sortie d'erreur, rend la réponse. */
  ask(question: string): Promise<string>
  /** Comme `ask`, sans afficher ce qui est tapé. */
  readSecret(question: string): Promise<string>
  /** Tout ce qui arrive sur l'entrée standard (un tube). */
  readStdin(): Promise<string>
}

export interface Ctx {
  args: ParsedArgs
  output: Output
  /** Vrai : le résultat s'écrit en JSON (l'objet rendu par la bibliothèque). */
  json: boolean
  /** Vrai : l'entrée standard est un terminal, on peut demander l'accord. */
  interactive: boolean
  env: Record<string, string | undefined>
  signal: AbortSignal
  fetch?: typeof fetch
  io: Io
  sleep: (ms: number, signal: AbortSignal) => Promise<void>
  baseUrl: string
  configPath: string
  config: StoredConfig
  /** Le client du compte, avec la clé résolue (`--key`, `NODIUM_KEY`, le fichier). */
  nodium(): Nodium
  /** Le client visé : `--tenant`, sinon celui de la clé. */
  scope(): TenantScope
  /**
   * Écrit le résultat : le JSON tel quel, ou les lignes de `human` suivies du
   * bloc « Next: » (les commandes à lancer ensuite), comme Kapso. Le JSON
   * reste l'objet de la bibliothèque : `next` n'y entre pas.
   */
  print(data: unknown, human: () => void, next?: readonly string[]): void
  /** Demande l'accord avant une écriture ; refuse sans lui. */
  confirm(what: string): Promise<void>
}

/**
 * La sortie par défaut : lisible devant un terminal, JSON dans un tube (un
 * script ou un agent). `--output` l'impose.
 */
export function outputMode(value: string | undefined, stdoutIsTty: boolean): 'json' | 'human' {
  if (value === undefined) return stdoutIsTty ? 'human' : 'json'
  if (value !== 'json' && value !== 'human') throw new UsageError('--output must be json or human.')
  return value
}

/**
 * L'accord avant d'envoyer ou de changer quelque chose : `--yes` le donne ;
 * sinon, devant un terminal, la question « Proceed? [y/N] » ; hors d'un
 * terminal, sans `--yes`, la commande refuse (code 2).
 */
export async function confirmWrite(what: string, options: { yes: boolean, interactive: boolean, ask: (q: string) => Promise<string> }): Promise<void> {
  if (options.yes) return
  if (!options.interactive) {
    throw new UsageError(`${what}: this changes something and needs your approval. Run it again with --yes (not in a terminal, nobody can answer the question).`)
  }
  const answer = (await options.ask(`${what}. Proceed? [y/N] `)).trim().toLowerCase()
  if (answer !== 'y' && answer !== 'yes') throw new UsageError('Cancelled: nothing was sent or changed.')
}

/** Une commande : son chemin (`templates wait`), son aide, ses drapeaux et ce qu'elle fait. */
export interface Command {
  /** `['templates', 'wait']`, ou `['send']`. */
  path: string[]
  /** Les arguments obligatoires, dans l'ordre : `['<id>']`. */
  args?: string[]
  summary: string
  /** Les lignes d'aide sous « Options » (et au-delà). */
  help?: string
  /** Les drapeaux acceptés en plus des communs. */
  flags?: string[]
  /** Faux : la commande se passe de clé (`login`, `logout`). */
  needsKey?: boolean
  run(ctx: Ctx): Promise<number>
}

/** Les premiers éléments d'une liste parcourue page après page. */
export async function take<T>(items: AsyncIterable<T>, limit: number): Promise<T[]> {
  const out: T[] = []
  if (limit <= 0) return out
  for await (const item of items) {
    out.push(item)
    if (out.length >= limit) break
  }
  return out
}

/** Combien d'éléments montre une liste : `--limit`, 20 par défaut. */
export const DEFAULT_LIMIT = 20

export function listLimit(args: ParsedArgs): number {
  return readInteger(args, 'limit', 1) ?? DEFAULT_LIMIT
}

/** La taille d'une page demandée à l'API pour en montrer `limit` (100 au plus). */
export function pageSize(limit: number): number {
  return Math.min(limit, 100)
}
