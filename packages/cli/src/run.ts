import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { DEFAULT_BASE_URL, Nodium, type TenantScope } from '@nodium.io/whatsapp'
import { UsageError, flag, hasFlag, parseArgs, rejectUnknown } from './args'
import { COMMANDS, findCommands } from './commands/index'
import { configPath as defaultConfigPath, readConfig, resolveKey } from './config'
import { confirmWrite, outputMode, type Command, type Ctx, type Io } from './context'
import { pause } from './listen'
import { describeError, errorJson, paint, table, type Output, printNext } from './output'

/**
 * La commande `nodium` : lit la ligne de commande, cherche la commande dans la
 * table (`commands/index.ts`), branche le client, rend le code de sortie
 * (0 réussi, 1 refusé par Nodium ou par Meta, 2 mal appelé).
 *
 * ⚠️ La clé se donne de préférence par `nodium login` ou `NODIUM_KEY` :
 *    `--key` reste dans l'historique du terminal.
 */

/** Les drapeaux qu'accepte toute commande. */
const COMMON = ['key', 'tenant', 'base-url', 'output', 'yes', 'no-color', 'help']

const COMMON_HELP = `Options for every command
  --key <nod_…>          API key. Default: $NODIUM_KEY, then the key saved by \`nodium login\`.
  --tenant <id>          Act for one client: its id or your own externalId.
  --output <json|human>  json: the API's object, for scripts and agents. Default: human in a
                         terminal, json when piped.
  -y, --yes              Approve a command that sends or changes something, without asking.
                         Required when not in a terminal.
  --base-url <url>       API address. Default: ${DEFAULT_BASE_URL} ($NODIUM_BASE_URL).
  --no-color             No colors (also: $NO_COLOR).
  -h, --help             This help, or the help of a command.
  -v, --version          The version.`

function usage(command: Command): string {
  return ['nodium', ...command.path, ...(command.args ?? [])].join(' ')
}

export function globalHelp(): string {
  return `nodium: the Nodium WhatsApp API from your terminal.

Commands
${table(COMMANDS.map(c => [`  ${usage(c)}`, c.summary])).join('\n')}

${COMMON_HELP}

Exit codes: 0 done, 1 refused by Nodium or Meta, 2 wrong command line.
More: nodium help <command>, for example \`nodium help templates wait\`.
`
}

export function commandHelp(command: Command): string {
  return `${usage(command)}: ${command.summary}

Usage
  ${usage(command)}${command.flags?.length ? ' [options]' : ''}
${command.help ? `\nOptions\n${command.help}\n` : ''}
Options for every command: \`nodium --help\`.
`
}

function groupHelp(noun: string, commands: Command[]): string {
  return `nodium ${noun}

${table(commands.map(c => [`  ${usage(c)}`, c.summary])).join('\n')}

More: nodium help ${noun} <${commands.map(c => c.path[1]).join('|')}>
`
}

function packageVersion(): string {
  try {
    const file = fileURLToPath(new URL('../package.json', import.meta.url))
    return String(JSON.parse(readFileSync(file, 'utf8')).version)
  } catch {
    return 'unknown'
  }
}

export interface RunContext {
  env: Record<string, string | undefined>
  output: Output
  signal: AbortSignal
  fetch?: typeof fetch
  /** Vrai : la sortie standard est un terminal (défaut de `--output`). */
  stdoutIsTty?: boolean
  /** Vrai : l'entrée standard est un terminal (on peut demander l'accord). */
  interactive?: boolean
  io?: Io
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>
  /** Le fichier de `nodium login` ; défaut : `configPath(env)`. */
  configPath?: string
}

const NO_IO: Io = {
  ask: async () => '',
  readSecret: async () => '',
  readStdin: async () => ''
}

/**
 * La commande nommée par les mots de la ligne : `templates wait` ou `send`.
 * Rend aussi les mots qui restent (ses arguments).
 */
export function resolveCommand(words: readonly string[]): { command: Command | null, rest: string[], group: Command[] } {
  const [noun, verb, ...more] = words
  if (!noun) return { command: null, rest: [], group: [] }
  const group = findCommands([noun])
  const exact = group.find(c => c.path.length === 1)
  if (exact) return { command: exact, rest: words.slice(1), group }
  const command = verb ? group.find(c => c.path[1] === verb) ?? null : null
  return { command, rest: command ? more : [], group }
}

export async function run(argv: readonly string[], context: RunContext): Promise<number> {
  const { output, env } = context
  let baseUrl = env.NODIUM_BASE_URL || DEFAULT_BASE_URL
  let json = false
  try {
    const args = parseArgs(argv)
    json = outputMode(flag(args, 'output'), Boolean(context.stdoutIsTty)) === 'json'
    if (hasFlag(args, 'version')) {
      output.out(packageVersion())
      return 0
    }

    // `nodium help templates wait` vaut `nodium templates wait --help`.
    const asksHelp = args.command === 'help' || hasFlag(args, 'help')
    const words = args.command === 'help' ? args.positionals : [args.command ?? '', ...args.positionals].filter(Boolean)
    if (!words.length) {
      output.out(globalHelp())
      return asksHelp ? 0 : 2
    }
    const { command, rest, group } = resolveCommand(words)
    if (!command) {
      if (!group.length) throw new UsageError(`Unknown command "${words[0]}". Try \`nodium --help\`.`)
      if (asksHelp || words.length === 1) {
        output.out(groupHelp(words[0]!, group))
        return asksHelp ? 0 : 2
      }
      throw new UsageError(`Unknown command "${words.slice(0, 2).join(' ')}". Try \`nodium help ${words[0]}\`.`)
    }
    if (asksHelp) {
      output.out(commandHelp(command))
      return 0
    }

    const name = command.path.join(' ')
    const commandArgs = { ...args, command: name, positionals: rest }
    rejectUnknown(commandArgs, [...COMMON, ...(command.flags ?? [])], name, command.args?.length ?? 0)

    const path = context.configPath ?? defaultConfigPath(env)
    const config = readConfig(path)
    baseUrl = flag(args, 'base-url') ?? (env.NODIUM_BASE_URL || config.baseUrl || DEFAULT_BASE_URL)

    let client: Nodium | null = null
    const nodium = (): Nodium => {
      if (!client) {
        const { key } = resolveKey(flag(args, 'key'), env, config)
        client = new Nodium(key, { baseUrl, ...(context.fetch ? { fetch: context.fetch } : {}) })
      }
      return client
    }
    const io = context.io ?? NO_IO
    const interactive = Boolean(context.interactive)
    const ctx: Ctx = {
      args: commandArgs, output, json, interactive, env, signal: context.signal, io,
      ...(context.fetch ? { fetch: context.fetch } : {}),
      sleep: context.sleep ?? pause,
      baseUrl, configPath: path, config,
      nodium,
      scope: (): TenantScope => {
        const tenant = flag(args, 'tenant')
        return tenant ? nodium().as(tenant) : nodium()
      },
      print: (data, human, next) => {
        if (json) return output.out(JSON.stringify(data, null, 2))
        human()
        printNext(output, next)
      },
      confirm: what => confirmWrite(what, { yes: hasFlag(args, 'yes'), interactive, ask: io.ask })
    }
    if (command.needsKey !== false) nodium()
    return await command.run(ctx)
  } catch (error) {
    output.err(json ? errorJson(error) : paint(output, 'red', describeError(error, baseUrl)))
    return error instanceof UsageError ? 2 : 1
  }
}
