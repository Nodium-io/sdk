import type { Message, MessageErrorInfo, Template, TemplateStatus } from './types'

/**
 * Les événements de webhook de Nodium : leurs noms et la forme de leur
 * charge. La vérification de la signature vit dans `server.ts`
 * (`@nodium.io/whatsapp/server`), seul endroit qui demande `node:crypto`.
 *
 * Nodium signe chaque appel : `X-Nodium-Signature: t=<secondes>,v1=<hex>`, où
 * `v1 = hmac-sha256(secret, "<t>.<corps brut>")`. Pendant un changement de
 * secret, l'en-tête porte DEUX `v1=` (le nouveau, puis l'ancien) : un seul
 * doit correspondre.
 *
 * ⚠️ Il faut le corps BRUT, tel que reçu : le relire après un `JSON.parse`
 *    change les octets et casse la signature.
 * ⚠️ Le délai de tolérance protège du rejeu : un appel plus vieux que
 *    `toleranceSeconds` (5 minutes par défaut) est refusé.
 * ⚠️ Une relivraison garde le même `id` d'événement : dédoublonnez dessus.
 */
export const WEBHOOK_EVENTS = [
  'message.received', 'message.imported', 'message.echoed', 'message.edited', 'message.revoked', 'message.sent', 'message.delivered', 'message.read', 'message.failed',
  'conversation.opened',
  'contact.opted_in', 'contact.opted_out',
  'template.status_changed',
  'channel.connected', 'channel.connect_failed', 'channel.health_changed', 'history.progress'
] as const

export type WebhookEventName = typeof WEBHOOK_EVENTS[number]

/** L'enveloppe de toute charge utile. `data` dépend de `event`. */
export interface WebhookEvent<E extends WebhookEventName = WebhookEventName, D = Record<string, unknown>> {
  /** `evt_…` : le même à chaque relivraison. */
  id: string
  event: E
  /** L'identifiant du client (l'espace) concerné. */
  workspace_id: string
  /** L'identifiant de ce client chez vous (`externalId`) ; `null` pour « Mon entreprise ». */
  external_id: string | null
  occurred_at: string
  data: D
}

/**
 * Le contenu de `data` est défini côté serveur événement par événement ; on ne
 * type ici que ce qui est stable et connu, le reste reste un objet ouvert.
 */
export type NodiumEvent =
  | WebhookEvent<'message.received' | 'message.imported' | 'message.echoed' | 'message.edited' | 'message.revoked' | 'message.sent' | 'message.delivered' | 'message.read', Partial<Message> & Record<string, unknown>>
  | WebhookEvent<'message.failed', Partial<Message> & { error_code?: number, error_info?: MessageErrorInfo | null } & Record<string, unknown>>
  | WebhookEvent<'template.status_changed', { template_id?: string, status?: TemplateStatus | string, category?: string } & Partial<Template> & Record<string, unknown>>
  | WebhookEvent<'conversation.opened' | 'contact.opted_in' | 'contact.opted_out' | 'channel.connected' | 'channel.connect_failed' | 'channel.health_changed' | 'history.progress'>

export interface VerifyOptions {
  /** Défaut : 300 (5 minutes). `0` désactive le contrôle du délai. */
  toleranceSeconds?: number
  /** L'instant courant en secondes (tests). */
  now?: number
}
