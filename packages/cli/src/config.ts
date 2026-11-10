import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { UsageError } from './args'

/**
 * La clé gardée par `nodium login` : `$XDG_CONFIG_HOME/nodium/config.json`
 * (par défaut `~/.config/nodium/config.json`), lisible par son seul
 * propriétaire (0600).
 *
 * ⚠️ La clé se cherche dans cet ordre : `--key`, `NODIUM_KEY`, ce fichier. Elle
 *    ne s'écrit jamais en entier à l'écran : son début seulement (`maskKey`).
 */

export interface StoredConfig {
  key?: string
  baseUrl?: string
}

export function configPath(env: Record<string, string | undefined>): string {
  return join(env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'nodium', 'config.json')
}

/** Le fichier lu ; absent ou illisible : rien. */
export function readConfig(path: string): StoredConfig {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

export function writeConfig(path: string, config: StoredConfig): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 })
  // Un fichier déjà là garde ses droits à l'écriture : on les resserre.
  chmodSync(path, 0o600)
}

/** Vrai si un fichier a été effacé. */
export function deleteConfig(path: string): boolean {
  try {
    readFileSync(path)
  } catch {
    return false
  }
  rmSync(path, { force: true })
  return true
}

export type KeySource = '--key' | 'NODIUM_KEY' | 'config'

/** La clé à employer, et d'où elle vient : `--key`, puis `NODIUM_KEY`, puis le fichier. */
export function resolveKey(flagKey: string | undefined, env: Record<string, string | undefined>, config: StoredConfig): { key: string, source: KeySource } {
  if (flagKey) return { key: flagKey, source: '--key' }
  if (env.NODIUM_KEY) return { key: env.NODIUM_KEY, source: 'NODIUM_KEY' }
  if (config.key) return { key: config.key, source: 'config' }
  throw new UsageError('No API key: run `nodium login`, or set NODIUM_KEY (or pass --key). Create one in the console, under Settings › API keys.')
}

/** Le début d'une clé, assez pour la reconnaître : `nod_ab12…`. */
export function maskKey(key: string): string {
  return `${key.slice(0, 8)}…`
}
