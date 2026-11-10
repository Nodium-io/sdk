#!/usr/bin/env node
/**
 * Fabrique `dist/` de la commande `nodium` (ESM), par `tsc`.
 *
 * La commande dépend de `@nodium.io/whatsapp`. Dans le dépôt, ses types se
 * lisent dans `../whatsapp/dist` (`paths` de `tsconfig.json`) : le paquet
 * voisin est donc construit d'abord s'il ne l'est pas. Le JavaScript produit
 * garde l'import `@nodium.io/whatsapp`, résolu à l'installation par la
 * dépendance publiée.
 *
 * ⚠️ Comme pour la bibliothèque, `.js` est ajouté à chaque import relatif
 *    (Node le refuse sans, en ESM), et `dist/` est effacé d'abord.
 *
 *   npm run build              (aussi lancé par `prepublishOnly`)
 *   npm run typecheck          (`--check` : les types seuls, rien n'est écrit)
 */
import { chmodSync, existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DIST = join(ROOT, 'dist')
const LIBRARY = resolve(ROOT, '../whatsapp')
const checkOnly = process.argv.includes('--check')

// Les types de la bibliothèque voisine.
if (!existsSync(join(LIBRARY, 'dist', 'index.d.ts'))) {
  if (!existsSync(join(LIBRARY, 'node_modules'))) execFileSync('npm', ['install'], { stdio: 'inherit', cwd: LIBRARY })
  execFileSync('npm', ['run', 'build'], { stdio: 'inherit', cwd: LIBRARY })
}

const tsc = createRequire(join(ROOT, 'package.json')).resolve('typescript/bin/tsc')
if (checkOnly) {
  execFileSync(process.execPath, [tsc, '-p', join(ROOT, 'tsconfig.json'), '--noEmit'], { stdio: 'inherit', cwd: ROOT })
  process.exit(0)
}

rmSync(DIST, { recursive: true, force: true })
execFileSync(process.execPath, [tsc, '-p', join(ROOT, 'tsconfig.json')], { stdio: 'inherit', cwd: ROOT })

/** `./run` → `./run.js`. */
function withExtension(from, specifier) {
  if (!specifier.startsWith('.') || /\.(js|mjs|cjs|json)$/.test(specifier)) return specifier
  const target = resolve(dirname(from), specifier)
  if (existsSync(`${target}.js`)) return `${specifier}.js`
  if (existsSync(join(target, 'index.js'))) return `${specifier}/index.js`
  throw new Error(`${from} : l'import « ${specifier} » ne mène à aucun fichier de dist/.`)
}

/** Les fichiers `.js` de `dist/`, sous-dossiers compris (`commands/`). */
function jsFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const file = join(dir, name)
    return statSync(file).isDirectory() ? jsFiles(file) : name.endsWith('.js') ? [file] : []
  })
}

for (const file of jsFiles(DIST)) {
  const source = readFileSync(file, 'utf8')
  const fixed = source.replace(
    /(\b(?:from|import)\s*\(?\s*)(['"])(\.{1,2}\/[^'"]*)\2/g,
    (_, lead, quote, specifier) => `${lead}${quote}${withExtension(file, specifier)}${quote}`
  )
  if (fixed !== source) writeFileSync(file, fixed)
}

// La commande doit être exécutable ; npm le refait à l'installation, mais pas pour `npm link`.
chmodSync(join(DIST, 'index.js'), 0o755)
console.log('dist/ : la commande nodium est construite.')
