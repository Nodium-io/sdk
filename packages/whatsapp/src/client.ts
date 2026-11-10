import { Http, type NodiumOptions } from './http'
import {
  ApiRequests, Billing, Broadcasts, Channels, ConnectLinks, Contacts, Conversations, Events, Flows, Keys, Media, Messages,
  Sandbox, Stats, Templates, Tenants, Webhooks
} from './resources'
import type { Health } from './types'

/** Un appel brut (`request`) : la méthode, le chemin sous `/api/v1`, et au besoin le reste. */
export interface RawRequest {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  path: string
  query?: Record<string, unknown>
  body?: unknown
  headers?: Record<string, string>
  /** Une clé anti-doublon : l'écriture devient rejouable, et se réessaie. */
  idempotencyKey?: string
  signal?: AbortSignal
}

/**
 * Ce qui agit DANS un client : ses messages, ses conversations, ses numéros…
 * On l'obtient par `nodium.as(id)`. Le client est nommé dans l'en-tête
 * `Nodium-Tenant` de chaque appel ; l'objet ne garde aucun état de plus.
 */
export class TenantScope {
  readonly messages: Messages
  readonly conversations: Conversations
  readonly channels: Channels
  readonly templates: Templates
  readonly contacts: Contacts
  readonly webhooks: Webhooks
  readonly broadcasts: Broadcasts
  readonly events: Events
  readonly flows: Flows
  readonly media: Media
  readonly stats: Stats
  readonly apiRequests: ApiRequests

  constructor(protected readonly http: Http, protected readonly tenantRef: string | null) {
    this.messages = new Messages(http, tenantRef)
    this.conversations = new Conversations(http, tenantRef)
    this.channels = new Channels(http, tenantRef)
    this.templates = new Templates(http, tenantRef)
    this.contacts = new Contacts(http, tenantRef)
    this.webhooks = new Webhooks(http, tenantRef)
    this.broadcasts = new Broadcasts(http, tenantRef)
    this.events = new Events(http, tenantRef)
    this.flows = new Flows(http, tenantRef)
    this.media = new Media(http, tenantRef)
    this.stats = new Stats(http, tenantRef)
    this.apiRequests = new ApiRequests(http, tenantRef)
  }

  /**
   * Appeler une route de l'API que le SDK n'enveloppe pas encore, avec la clé,
   * le client visé (`Nodium-Tenant`) et les mêmes nouvelles tentatives. Rend le
   * contenu de `data`. `path` part de `/api/v1` : `'/flows/encryption'`.
   *
   * ⚠️ Une écriture n'est réessayée que si `idempotencyKey` est donnée.
   */
  request<T = unknown>(input: RawRequest): Promise<T> {
    const { idempotencyKey, ...rest } = input
    return this.http.request<T>({
      ...rest,
      tenant: this.tenantRef,
      idempotent: idempotencyKey !== undefined,
      headers: { ...input.headers, ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}) }
    })
  }
}

/**
 * Le client de l'API Nodium.
 *
 * ```ts
 * const nodium = new Nodium(process.env.NODIUM_KEY!)
 * const client = await nodium.tenants.create({ name: 'Agence Horizon', externalId: 'crm-4187' }, { connectLink: true })
 * // envoyez client.connectLink.url à votre client : il branche son WhatsApp
 * await nodium.as('crm-4187').messages.send({ channelId, to: '+33612345678', templateName: 'booking_confirmed' })
 * ```
 *
 * Utilisé tel quel, il agit sur « Mon entreprise » (ou sur le client auquel la
 * clé est épinglée) ; `as(id)` désigne un autre client du compte.
 */
export class Nodium extends TenantScope {
  readonly tenants: Tenants
  readonly keys: Keys
  readonly connectLinks: ConnectLinks
  readonly billing: Billing
  readonly sandbox: Sandbox

  constructor(key: string, options: NodiumOptions = {}) {
    super(new Http(key, options), null)
    this.tenants = new Tenants(this.http)
    this.keys = new Keys(this.http)
    this.connectLinks = new ConnectLinks(this.http)
    this.billing = new Billing(this.http)
    this.sandbox = new Sandbox(this.http)
  }

  /**
   * Agir pour un client : son id, ou votre `externalId`. Une clé épinglée à un
   * autre client reçoit 404 (`tenant_not_found`), jamais 403.
   */
  as(tenantId: string): TenantScope {
    if (!tenantId) throw new TypeError('Nodium.as(): a tenant id or externalId is required.')
    return new TenantScope(this.http, tenantId)
  }

  /** Tout va-t-il bien : un état d'ensemble, et ce qui ne va pas. */
  health(): Promise<Health> {
    return this.http.request({ method: 'GET', path: '/health', tenant: this.tenantRef })
  }
}
