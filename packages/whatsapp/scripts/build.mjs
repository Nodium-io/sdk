#!/usr/bin/env node
/**
 * Fabrique `dist/` : le JavaScript ESM et les `.d.ts` (`tsconfig.build.json`),
 * puis la même chose en CommonJS sous `dist/cjs/` (`tsconfig.cjs.json`), types
 * compris, pour qui charge le paquet par `require` — les deux entrées, `.` et
 * `./server`. ⚠️ Les types CommonJS ont leurs propres fichiers : sous
 * `"type": "module"`, TypeScript lirait ceux de `dist/` comme de l'ESM et
 * refuserait l'import dans un projet CommonJS.
 *
 * ⚠️ Les sources importent sans extension (`./client`), ce que `tsc` laisse tel
 *    quel et que Node refuse en ESM : une étape ajoute `.js` à chaque adresse
 *    relative de la partie ESM, dans le JavaScript comme dans les `.d.ts`.
 *    `require` résout sans extension : la partie CommonJS reste telle quelle,
 *    son `package.json` la déclare `commonjs`.
 * ⚠️ `dist/` est effacé d'abord : un fichier supprimé de `src/` ne survit pas
 *    dans le paquet.
 *
 *   npm run build      (aussi lancé par `prepublishOnly`)
 */
import { existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DIST = join(ROOT, 'dist')

rmSync(DIST, { recursive: true, force: true })

const tsc = createRequire(join(ROOT, 'package.json')).resolve('typescript/bin/tsc')
execFileSync(process.execPath, [tsc, '-p', join(ROOT, 'tsconfig.build.json')], { stdio: 'inherit', cwd: ROOT })
execFileSync(process.execPath, [tsc, '-p', join(ROOT, 'tsconfig.cjs.json')], { stdio: 'inherit', cwd: ROOT })
writeFileSync(join(DIST, 'cjs', 'package.json'), '{ "type": "commonjs" }\n')

/** Les fichiers de la partie ESM ; `dist/cjs/` n'est pas touché. */
function* files(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (path === join(DIST, 'cjs')) continue
    if (statSync(path).isDirectory()) yield* files(path)
    else if (/\.(js|d\.ts)$/.test(name)) yield path
  }
}

/** `./client` → `./client.js` ; un dossier → `./dossier/index.js`. */
function withExtension(from, specifier) {
  if (!specifier.startsWith('.') || /\.(js|mjs|cjs|json)$/.test(specifier)) return specifier
  const target = resolve(dirname(from), specifier)
  if (existsSync(`${target}.js`)) return `${specifier}.js`
  if (existsSync(join(target, 'index.js'))) return `${specifier}/index.js`
  throw new Error(`${from} : l'import « ${specifier} » ne mène à aucun fichier de dist/.`)
}

let rewritten = 0
for (const file of files(DIST)) {
  const source = readFileSync(file, 'utf8')
  const fixed = source.replace(
    /(\b(?:from|import)\s*\(?\s*)(['"])(\.{1,2}\/[^'"]*)\2/g,
    (_, lead, quote, specifier) => `${lead}${quote}${withExtension(file, specifier)}${quote}`
  )
  if (fixed !== source) {
    writeFileSync(file, fixed)
    rewritten++
  }
}

console.log(`dist/ : construit, ${rewritten} fichiers aux imports complétés.`)
