/**
 * Les arguments de la ligne de commande, sans dépendance : `--nom valeur`,
 * `--nom=valeur`, un drapeau sans valeur (`--verbose`), `--` pour finir.
 *
 * ⚠️ Un drapeau qui prend une valeur prend le mot SUIVANT tel quel, même s'il
 *    commence par `--` : `--text "--hello"` envoie `--hello`.
 */

/** Une faute d'usage : message lisible, code de sortie 2, aucune trace d'appel. */
export class UsageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UsageError'
  }
}

/** Les drapeaux qui ne prennent jamais de valeur. */
const SWITCHES = new Set(['help', 'version', 'verbose', 'no-color', 'yes', 'stdin', 'publish', 'failed', 'all', 'connect-link', 'errors'])

/** Les abréviations d'une lettre. */
const SHORT: Record<string, string> = { h: 'help', v: 'version', y: 'yes' }

export interface ParsedArgs {
  /** Le premier mot qui n'est pas un drapeau (`listen`, `templates`), ou `null`. */
  command: string | null
  /** Les autres mots, dans l'ordre. */
  positionals: string[]
  /** Chaque drapeau et ses valeurs (un drapeau répété les accumule). */
  flags: Map<string, string[]>
}

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const flags = new Map<string, string[]>()
  const words: string[] = []
  const add = (name: string, value: string) => flags.set(name, [...(flags.get(name) ?? []), value])

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (arg === '--') {
      words.push(...argv.slice(i + 1))
      break
    }
    const short = /^-([a-zA-Z])$/.exec(arg)
    if (short) {
      const name = SHORT[short[1]!]
      if (!name) throw new UsageError(`Unknown option ${arg}.`)
      add(name, 'true')
      continue
    }
    if (!arg.startsWith('--')) {
      words.push(arg)
      continue
    }
    const eq = arg.indexOf('=')
    const name = eq < 0 ? arg.slice(2) : arg.slice(2, eq)
    if (!name) throw new UsageError(`Unknown option ${arg}.`)
    if (SWITCHES.has(name)) {
      add(name, 'true')
      continue
    }
    if (eq >= 0) {
      add(name, arg.slice(eq + 1))
      continue
    }
    const value = argv[++i]
    if (value === undefined) throw new UsageError(`--${name} needs a value.`)
    add(name, value)
  }

  return { command: words.shift() ?? null, positionals: words, flags }
}

/** La dernière valeur d'un drapeau, ou `undefined`. */
export function flag(args: ParsedArgs, name: string): string | undefined {
  const values = args.flags.get(name)
  return values?.[values.length - 1]
}

/** Toutes les valeurs d'un drapeau répété. */
export function flagAll(args: ParsedArgs, name: string): string[] {
  return args.flags.get(name) ?? []
}

export function hasFlag(args: ParsedArgs, name: string): boolean {
  return args.flags.has(name)
}

/**
 * Refuse un drapeau que la commande ne connaît pas, et un nombre d'arguments
 * qui n'est pas le sien : une faute de frappe ne passe pas en silence.
 * `name` est le chemin de la commande (`templates wait`).
 */
export function rejectUnknown(args: ParsedArgs, allowed: readonly string[], name: string, arity = 0): void {
  for (const key of args.flags.keys()) {
    if (!allowed.includes(key)) throw new UsageError(`Unknown option --${key} for \`${name}\`. Try \`nodium ${name} --help\`.`)
  }
  if (args.positionals.length > arity) throw new UsageError(`Unexpected argument "${args.positionals[arity]}". Try \`nodium ${name} --help\`.`)
  if (args.positionals.length < arity) throw new UsageError(`Missing argument. Try \`nodium ${name} --help\`.`)
}

/** Un entier au moins égal à `min`, ou `null` si le drapeau est absent. */
export function readInteger(args: ParsedArgs, name: string, min: number): number | null {
  const text = flag(args, name)
  if (text === undefined) return null
  const value = Number(text)
  if (!Number.isInteger(value) || value < min) throw new UsageError(`--${name} must be a whole number, ${min} or more.`)
  return value
}
