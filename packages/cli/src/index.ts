#!/usr/bin/env node
import { createInterface } from 'node:readline'
import { Writable } from 'node:stream'
import type { Io } from './context'
import { run } from './run'

/**
 * Le point d'entrée de `nodium` (`bin` du paquet). Ctrl+C et SIGTERM arrêtent
 * proprement : la boucle de `listen` finit l'événement en cours, puis la
 * commande dit où reprendre. Un second Ctrl+C sort tout de suite.
 */
const argv = process.argv.slice(2)
const controller = new AbortController()

const stop = () => {
  if (controller.signal.aborted) process.exit(130)
  controller.abort()
  process.stderr.write('\nStopping…\n')
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)

const color = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR && !argv.includes('--no-color')

/** Une question au terminal, sur la sortie d'erreur ; `hidden` n'affiche pas la frappe. */
function prompt(question: string, hidden: boolean): Promise<string> {
  return new Promise((resolve) => {
    let muted = false
    const sink = new Writable({
      write(chunk, encoding, done) {
        if (!muted) process.stderr.write(chunk, encoding)
        done()
      }
    })
    const rl = createInterface({ input: process.stdin, output: sink, terminal: true })
    // Ctrl+C pendant la question : une réponse vide, donc « non ».
    rl.on('SIGINT', () => {
      rl.close()
      process.stderr.write('\n')
      resolve('')
    })
    rl.question(question, (answer) => {
      rl.close()
      if (hidden) process.stderr.write('\n')
      resolve(answer)
    })
    muted = hidden
  })
}

const io: Io = {
  ask: question => prompt(question, false),
  readSecret: question => prompt(question, true),
  readStdin: async () => {
    const chunks: Buffer[] = []
    for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk))
    return Buffer.concat(chunks).toString('utf8')
  }
}

run(argv, {
  env: process.env,
  signal: controller.signal,
  stdoutIsTty: Boolean(process.stdout.isTTY),
  interactive: Boolean(process.stdin.isTTY),
  io,
  output: {
    out: text => process.stdout.write(`${text}\n`),
    err: text => process.stderr.write(`${text}\n`),
    color
  }
}).then(
  (code) => { process.exitCode = code },
  (error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
)
