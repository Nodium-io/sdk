/**
 * @nodium.io/whatsapp — le client TypeScript de l'API Nodium pour WhatsApp.
 * Aucune dépendance : `fetch` natif (Node 20+, navigateurs, Deno, Bun). La
 * vérification des webhooks, qui demande `node:crypto`, s'importe à part :
 * `@nodium.io/whatsapp/server`.
 */
import { Nodium } from './client'

export { Nodium, TenantScope } from './client'
export type { RawRequest } from './client'
export { NodiumError, NodiumSignatureError } from './errors'
export type { RetryAction, RetryHint } from './errors'
export { DEFAULT_BASE_URL, parseRetryAfter } from './http'
export type { NodiumOptions } from './http'
export { each } from './pagination'
export { newIdempotencyKey } from './resources'
export { WEBHOOK_EVENTS } from './webhooks'
export type { NodiumEvent, VerifyOptions, WebhookEvent, WebhookEventName } from './webhooks'
export type * from './types'
export default Nodium
