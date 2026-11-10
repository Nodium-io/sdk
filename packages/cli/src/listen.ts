import { NodiumError, WEBHOOK_EVENTS, type EventLogEntry, type TenantScope } from '@nodium.io/whatsapp'
import { signWebhook } from '@nodium.io/whatsapp/server'
import { UsageError } from './args'
import { clock, paint, type Output } from './output'

/**
 * `nodium listen` : les événements de votre compte, rejoués vers une adresse
 * locale, signés comme en production. Aucun tunnel : c'est la commande qui
 * interroge Nodium, jamais l'inverse.
 *
 * Elle lit le JOURNAL D'ÉVÉNEMENTS (`GET /events`, depuis un curseur) : chaque
 * ligne est l'enveloppe exacte d'un webhook, plus son `seq`. Le direct du
 * journal de la console (`GET /events/stream`) porte d'autres lignes (messages,
 * livraisons, appels) et non ces enveloppes : il ne sert pas ici.
 *
 * ⚠️ Le corps envoyé est l'enveloppe SANS `seq`, sérialisée une fois ; la
 *    signature est calculée sur ces octets (`t=<s>,v1=hmac-sha256(secret, "<t>.<corps>")`,
 *    la même fonction que `signWebhook` de `@nodium.io/whatsapp/server`). Un récepteur qui vérifie sur
 *    le corps brut accepte l'appel comme en production.
 * ⚠️ Le curseur avance après chaque page rejouée, que l'adresse locale ait
 *    répondu ou non : un échec local n'est pas rejoué (production le fait ;
 *    ici, relancez avec `--from <seq>` ou rejouez depuis la console).
 * ⚠️ `message.imported` ne sonne jamais en production : il n'est rejoué que si
 *    `--events` le nomme.
 */

/** Le délai d'attente de l'adresse locale : celui de Nodium en production. */
export const FORWARD_TIMEOUT_MS = 10_000

/** Événements lus par appel (le défaut de l'API est 100, son plafond 500). */
const PAGE = 100

/** Attente entre deux lectures du journal quand il n'y a rien de neuf, en millisecondes. */
export const DEFAULT_INTERVAL_MS = 1000
const MIN_INTERVAL_MS = 250

/** L'attente maximale entre deux essais quand Nodium est injoignable. */
const BACKOFF_CAP_MS = 15_000

export interface Delivery {
  body: string
  headers: Record<string, string>
}

/**
 * L'appel que Nodium ferait : le corps (l'enveloppe, sans `seq`) et les
 * en-têtes. Sans `secret`, pas d'en-tête de signature.
 */
export function buildDelivery(entry: EventLogEntry, secret: string | null, nowSeconds = Math.floor(Date.now() / 1000)): Delivery {
  const envelope = Object.fromEntries(Object.entries(entry).filter(([key]) => key !== 'seq'))
  const body = JSON.stringify(envelope)
  return {
    body,
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Nodium-Webhooks/1',
      'X-Nodium-Event': entry.event,
      'X-Nodium-Delivery': `local-${entry.id}`,
      ...(secret ? { 'X-Nodium-Signature': signWebhook(secret, nowSeconds, body) } : {})
    }
  }
}

/**
 * `--events message.received,message.failed` → l'ensemble voulu ; `null` pour
 * « tous ceux qui sonnent ». `*` veut dire tous, comme dans un abonnement.
 */
export function parseEventFilter(text: string | undefined): Set<string> | null {
  if (text === undefined) return null
  const names = text.split(',').map(name => name.trim()).filter(Boolean)
  if (!names.length) throw new UsageError('--events needs at least one event name.')
  if (names.includes('*')) return null
  const known = new Set<string>(WEBHOOK_EVENTS)
  const unknown = names.filter(name => !known.has(name))
  if (unknown.length) throw new UsageError(`Unknown event ${unknown.map(n => `"${n}"`).join(', ')}. Known: ${WEBHOOK_EVENTS.join(', ')}.`)
  return new Set(names)
}

/** Cet événement est-il rejoué ? Sans filtre : tous, sauf l'historique importé. */
export function wanted(filter: Set<string> | null, event: string): boolean {
  return filter ? filter.has(event) : event !== 'message.imported'
}

/** L'adresse locale : http ou https, rien d'autre. */
export function parseForwardUrl(text: string | undefined): string {
  if (!text) throw new UsageError('--forward <url> is required, for example --forward http://localhost:3000/webhook.')
  let url: URL
  try {
    url = new URL(text)
  } catch {
    throw new UsageError(`--forward "${text}" is not a valid URL. Example: http://localhost:3000/webhook.`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new UsageError('--forward must be an http:// or https:// URL.')
  return url.toString()
}

export interface Forwarded {
  /** Le statut de l'adresse locale ; `null` si elle n'a pas répondu. */
  status: number | null
  ms: number
  /** Pourquoi elle n'a pas répondu (refus de connexion, délai…). */
  error: string | null
}

async function forwardOne(url: string, delivery: Delivery, fetchImpl: typeof fetch): Promise<Forwarded> {
  const started = performance.now()
  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: delivery.headers,
      body: delivery.body,
      redirect: 'manual',
      signal: AbortSignal.timeout(FORWARD_TIMEOUT_MS)
    })
    await response.arrayBuffer().catch(() => {})
    return { status: response.status, ms: Math.round(performance.now() - started), error: null }
  } catch (cause: any) {
    const ms = Math.round(performance.now() - started)
    if (cause?.name === 'TimeoutError' || cause?.name === 'AbortError') {
      return { status: null, ms, error: `no answer within ${FORWARD_TIMEOUT_MS / 1000} s (Nodium waits as long in production)` }
    }
    const code = cause?.cause?.code ?? cause?.code
    if (code === 'ECONNREFUSED') return { status: null, ms, error: `connection refused: is your server listening on ${new URL(url).host}?` }
    return { status: null, ms, error: String(cause?.cause?.message ?? cause?.message ?? cause) }
  }
}

export interface ListenOptions {
  /** Le client visé : `nodium` (le compte, ou la clé épinglée) ou `nodium.as(id)`. */
  scope: TenantScope
  /** L'adresse de l'API : sert au lien d'aide des erreurs. */
  baseUrl: string
  forward: string
  /** Le secret de signature ; `null` : aucun en-tête de signature. */
  secret: string | null
  events: Set<string> | null
  /** Partir de ce `seq` (les événements d'après) ; `null` : la tête du journal, maintenant. */
  from: number | null
  intervalMs: number
  verbose: boolean
  signal: AbortSignal
  output: Output
  fetch?: typeof fetch
  /** L'attente entre deux lectures (tests). Défaut : `setTimeout`, qu'`signal` interrompt. */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>
}

export interface ListenSummary {
  forwarded: number
  failed: number
  /** Le curseur où reprendre : `--from <after>`. */
  after: number
}

/** Une attente que l'arrêt interrompt. */
export function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve()
    const done = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', done)
      resolve()
    }
    const timer = setTimeout(done, ms)
    signal.addEventListener('abort', done, { once: true })
  })
}

/** Ce qui ne se réessaie pas : la clé, un appel interdit, le client visé. */
function isFatal(error: unknown): boolean {
  return error instanceof NodiumError && (error.status === 401 || error.status === 403 || error.status === 404)
}

export async function listen(options: ListenOptions): Promise<ListenSummary> {
  const { scope, signal, output } = options
  const fetchImpl = options.fetch ?? globalThis.fetch
  const sleep = options.sleep ?? pause
  const intervalMs = Math.max(MIN_INTERVAL_MS, options.intervalMs)
  const summary: ListenSummary = { forwarded: 0, failed: 0, after: 0 }

  // Un premier appel sans `after` rend la tête du journal : le curseur du « maintenant ».
  summary.after = options.from ?? (await scope.events.list()).next_after
  output.out(`${paint(output, 'bold', 'Listening')} ${options.from === null ? 'from now' : `after event #${options.from}`} → ${options.forward}`)
  output.out(paint(output, 'dim', options.secret
    ? 'Calls are signed with your secret: verify X-Nodium-Signature as in production.'
    : 'No --secret: calls carry no X-Nodium-Signature header.'))
  output.out(paint(output, 'dim', 'Press Ctrl+C to stop.'))

  let failures = 0
  while (!signal.aborted) {
    let full: boolean
    try {
      const page = await scope.events.list(summary.after, PAGE)
      if (failures) {
        output.out(paint(output, 'green', 'Connection with Nodium restored.'))
        failures = 0
      }
      for (const entry of page.data) {
        if (signal.aborted) break
        if (wanted(options.events, entry.event)) await deliver(entry, options, fetchImpl, summary)
        summary.after = entry.seq
      }
      // Une page rejouée en entier : tout ce qui précède `next_after` est rendu ou n'est pas à vous.
      if (!signal.aborted) summary.after = page.next_after
      full = page.data.length >= PAGE
    } catch (error) {
      if (error instanceof NodiumError && error.code === 'cursor_expired') {
        // Le journal garde 30 jours : un curseur plus vieux est repris à la tête.
        summary.after = (await scope.events.list()).next_after
        output.err(paint(output, 'yellow', 'The cursor is older than the event log (30 days): restarting from now.'))
        continue
      }
      if (isFatal(error)) throw error
      failures++
      const wait = Math.min(BACKOFF_CAP_MS, intervalMs * 2 ** failures)
      output.err(paint(output, 'yellow', `Nodium is unreachable (${error instanceof NodiumError ? error.code : 'error'}); retrying in ${Math.round(wait / 1000)} s from event #${summary.after}.`))
      await sleep(wait, signal)
      continue
    }
    if (!full) await sleep(intervalMs, signal)
  }
  return summary
}

/** Rejoue un événement et en écrit la ligne. */
async function deliver(entry: EventLogEntry, options: ListenOptions, fetchImpl: typeof fetch, summary: ListenSummary): Promise<void> {
  const { output } = options
  const result = await forwardOne(options.forward, buildDelivery(entry, options.secret), fetchImpl)
  summary.forwarded++
  const ok = result.status !== null && result.status >= 200 && result.status < 300
  if (!ok) summary.failed++

  const client = entry.external_id ? ` [${entry.external_id}]` : ''
  const status = paint(output, ok ? 'green' : 'red', result.status === null ? 'ERR' : String(result.status))
  output.out(`${paint(output, 'dim', clock())}  ${entry.event.padEnd(24)} ${status}  ${String(result.ms).padStart(5)} ms  ${paint(output, 'dim', entry.id + client)}`)
  if (result.error) output.out(`          ${paint(output, 'red', result.error)}`)
  if (options.verbose) output.out(paint(output, 'dim', JSON.stringify(entry.data, null, 2).replace(/^/gm, '          ')))
}
