import { createHmac, timingSafeEqual } from 'node:crypto'
import { NodiumSignatureError } from './errors'
import type { NodiumEvent, VerifyOptions } from './webhooks'

/**
 * `@nodium.io/whatsapp/server` — ce qui ne tourne que sur un serveur Node :
 * vérifier la signature d'un webhook (et la fabriquer pour tester son propre
 * receveur), et recevoir les appels d'un Flow dynamique et y répondre. Séparé de l'entrée principale pour qu'elle reste sans
 * `node:crypto` (navigateurs, fonctions en périphérie).
 *
 * Voir `webhooks.ts` pour la signature : `X-Nodium-Signature: t=<s>,v1=<hex>`.
 */

/** Un en-tête, qu'il vienne d'un objet Node (minuscules) ou d'un `Headers`. */
function readHeader(headers: Headers | Record<string, string | string[] | undefined>, name: string): string | null {
  if (typeof (headers as Headers).get === 'function') return (headers as Headers).get(name)
  const lower = name.toLowerCase()
  for (const [key, value] of Object.entries(headers as Record<string, string | string[] | undefined>)) {
    if (key.toLowerCase() === lower) return Array.isArray(value) ? (value[0] ?? null) : (value ?? null)
  }
  return null
}

/** Ce que Nodium signe : `<t>.<corps>`. Exposé pour les tests de votre propre receveur. */
export function signWebhook(secret: string, timestampSeconds: number, rawBody: string): string {
  return `t=${timestampSeconds},v1=${createHmac('sha256', secret).update(`${timestampSeconds}.${rawBody}`).digest('hex')}`
}

type IncomingHeaders = Headers | Record<string, string | string[] | undefined>

/**
 * Vérifie la signature et rend l'événement lu. Lève `NodiumSignatureError`
 * sinon : répondez alors 400, sans traiter le corps.
 *
 * `secret` : celui de l'abonnement (`whsec_…`), ou une liste (le nouveau et
 * l'ancien pendant une rotation).
 */
export function verifyWebhook(
  rawBody: string | Uint8Array,
  headers: IncomingHeaders,
  secret: string | string[],
  options: VerifyOptions = {}
): NodiumEvent {
  return verifySigned(rawBody, headers, secret, options) as NodiumEvent
}

/** La signature contrôlée, le corps lu en JSON : le cœur commun aux webhooks et aux Flows. */
function verifySigned(
  rawBody: string | Uint8Array,
  headers: IncomingHeaders,
  secret: string | string[],
  options: VerifyOptions
): unknown {
  const header = readHeader(headers, 'x-nodium-signature')
  if (!header) throw new NodiumSignatureError('Missing X-Nodium-Signature header.')

  let timestamp = 0
  const signatures: string[] = []
  for (const part of header.split(',')) {
    const [k, ...rest] = part.trim().split('=')
    const v = rest.join('=')
    if (k === 't') timestamp = Number(v)
    else if (k === 'v1' && v) signatures.push(v)
  }
  if (!Number.isFinite(timestamp) || timestamp <= 0 || !signatures.length) {
    throw new NodiumSignatureError('Malformed X-Nodium-Signature header.')
  }

  const tolerance = options.toleranceSeconds ?? 300
  const now = options.now ?? Math.floor(Date.now() / 1000)
  if (tolerance > 0 && Math.abs(now - timestamp) > tolerance) {
    throw new NodiumSignatureError('The webhook timestamp is outside the tolerated window.')
  }

  const body = typeof rawBody === 'string' ? rawBody : new TextDecoder().decode(rawBody)
  const secrets = (Array.isArray(secret) ? secret : [secret]).filter(Boolean)
  const ok = secrets.some((s) => {
    const expected = Buffer.from(createHmac('sha256', s).update(`${timestamp}.${body}`).digest('hex'), 'hex')
    return signatures.some((given) => {
      const candidate = Buffer.from(given, 'hex')
      return candidate.length === expected.length && timingSafeEqual(candidate, expected)
    })
  })
  if (!ok) throw new NodiumSignatureError('No signature matches the payload.')

  try {
    return JSON.parse(body)
  } catch {
    throw new NodiumSignatureError('The payload is not valid JSON.')
  }
}

// ── Les Flows dynamiques ────────────────────────────────────────────────────

/**
 * Un appel d'un Flow dynamique, relayé par Nodium : Meta l'a chiffré, Nodium
 * l'a déchiffré et le POSTe à l'adresse du Flow (`flows.setDataEndpoint`),
 * signé comme un webhook avec le secret de cette adresse.
 */
export interface FlowRequest {
  /** `INIT` (le Flow s'ouvre), `data_exchange` (un écran envoie ses champs), `BACK` (retour). */
  action: 'INIT' | 'data_exchange' | 'BACK' | (string & {})
  /** L'écran qui appelle ; `null` à l'ouverture. */
  screen: string | null
  /** Ce que l'écran envoie. */
  data: Record<string, unknown>
  /** Le `flowToken` posé à l'envoi du Flow, ou `null`. */
  flowToken: string | null
  version: string
  /** Le Flow chez Nodium et chez Meta. */
  flow: { id: string, metaFlowId: string | null }
  /** Vrai pour l'appel d'essai de la console (`data-endpoint-test`). */
  test: boolean
  receivedAt: string
}

/** Ce qu'on répond à un appel de Flow : l'écran suivant et ses données. */
export interface FlowScreenResponse {
  screen: string
  data?: Record<string, unknown>
}

interface RelayedFlowCall {
  source?: string
  test?: boolean
  flow?: { id?: string, meta_flow_id?: string | null }
  data_exchange?: { version?: string, action?: string, screen?: string | null, data?: Record<string, unknown> | null, flow_token?: string | null }
  received_at?: string
}

/**
 * Vérifie la signature d'un appel de Flow relayé et le rend lu. Lève
 * `NodiumSignatureError` sinon : répondez alors 400.
 *
 * ```ts
 * app.post('/whatsapp/flow', express.raw({ type: 'application/json' }), (req, res) => {
 *   const call = receiveFlowRequest(req.body, req.headers, process.env.NODIUM_FLOW_SECRET!)
 *   if (call.screen === 'SLOTS') return res.json(respondToFlow({ screen: 'CONFIRM', data: { slots } }))
 *   res.json(completeFlow(call.flowToken))
 * })
 * ```
 *
 * ⚠️ Répondez en moins de 9 secondes environ : au-delà, Nodium montre au
 *    client « Le service ne répond pas » sur l'écran en cours.
 */
export function receiveFlowRequest(
  rawBody: string | Uint8Array,
  headers: IncomingHeaders,
  secret: string | string[],
  options: VerifyOptions = {}
): FlowRequest {
  const call = verifySigned(rawBody, headers, secret, options) as RelayedFlowCall
  if (!call || typeof call !== 'object' || call.source !== 'whatsapp_flow' || !call.data_exchange) {
    throw new NodiumSignatureError('The payload is not a WhatsApp Flow call.')
  }
  const exchange = call.data_exchange
  return {
    action: exchange.action ?? '',
    screen: exchange.screen ?? null,
    data: exchange.data ?? {},
    flowToken: exchange.flow_token ?? null,
    version: exchange.version ?? '3.0',
    flow: { id: call.flow?.id ?? '', metaFlowId: call.flow?.meta_flow_id ?? null },
    test: call.test === true,
    receivedAt: call.received_at ?? ''
  }
}

/** La réponse qui mène à l'écran suivant : à renvoyer en JSON, tel quel. */
export function respondToFlow(response: FlowScreenResponse): FlowScreenResponse {
  return { screen: response.screen, data: response.data ?? {} }
}

/** Montrer un message d'erreur sur l'écran en cours, sans changer d'écran. */
export function flowError(screen: string, message: string): FlowScreenResponse {
  return { screen, data: { error_message: message } }
}

/**
 * Fermer le Flow : WhatsApp le referme, et la réponse arrive dans votre
 * webhook (`message.received`, `reply.kind: 'flow'`). `params` y voyage avec
 * le `flowToken`.
 */
export function completeFlow(flowToken: string | null, params: Record<string, unknown> = {}): FlowScreenResponse {
  return {
    screen: 'SUCCESS',
    data: { extension_message_response: { params: { ...(flowToken ? { flow_token: flowToken } : {}), ...params } } }
  }
}

export { NodiumSignatureError } from './errors'
export { WEBHOOK_EVENTS } from './webhooks'
export type { NodiumEvent, VerifyOptions, WebhookEvent, WebhookEventName } from './webhooks'
