import type { Http } from './http'
import { queryString } from './http'
import { each } from './pagination'
import type {
  ApiKey, ApiKeyInput, ApiRequest, ApiRequestQuery, ConnectLinkUpdate, ConnectLinkUpdated, NumberDiagnostic, SandboxState, Broadcast, BroadcastInput, BroadcastPreview, BroadcastRecipient, BusinessProfile, BusinessProfilePatch, Channel,
  ChannelDetail, ConnectLink, ConnectLinkInput, ConnectLinkItem, ConnectLinkQuery,
  Contact, ContactExportQuery, ContactInput, ContactUpdate, Conversation, ConversationQuery, CreatedApiKey, CurrentApiKey,
  DeliveryStats, DeliveryStatsQuery, DeployOutcome, Flow, FlowDataEndpoint, FlowInput, FlowInvocation, FlowQuery,
  EventLogPage, FlowResponse, FlowResponseQuery, FlowValidationError, FlowVersion, MediaItem, MediaQuery, MediaUpload, MediaUploadOptions,
  Message,
  MessageQuery, Page, PageQuery, SendAddress, SendInput, SendResult, Template, TemplateHoles, TemplateInput,
  TemplateUpdate, DisplayName, Username, Tenant, TenantDeleted, TenantInput, TenantUpdate, TenantWithLink, WebhookDelivery,
  WebhookDeliveryQuery, WebhookInput, WebhookSubscription, WebhookUpdate, BillingSummary
} from './types'

/**
 * Les ressources de l'API. Chacune ne fait qu'un appel de plus haut niveau :
 * l'adresse, l'en-tête `Nodium-Tenant` quand un client est visé, et la forme
 * du retour (les routes qui rendent `{ tenant }` ou `{ contact }` sont
 * déballées ici).
 *
 * ⚠️ Un identifiant de client se donne tel quel : l'id de Nodium, ou votre
 *    `externalId`. Il est encodé dans l'adresse, jamais recopié à la main.
 */
const seg = encodeURIComponent

/** Une clé anti-doublon neuve : 8 à 200 caractères, unique par message. */
export function newIdempotencyKey(): string {
  return `sdk_${globalThis.crypto.randomUUID()}`
}

// ─────────────────────────────────────────────────────────────────────────────
//  Ce qui agit DANS un client (avec ou sans `Nodium-Tenant`)
// ─────────────────────────────────────────────────────────────────────────────

export class Messages {
  constructor(private readonly http: Http, private readonly tenant: string | null) {}

  /**
   * Envoyer un message, par canal et destinataire : `channelId`, et la personne
   * (`to`, un numéro E.164, ou `recipient`, son identifiant WhatsApp `wa:…`).
   * Nodium trouve ou ouvre le fil lui-même ; aucun identifiant de conversation
   * ne sert à envoyer. `type` dit ce qu'on envoie et quels champs l'accompagnent
   * (texte, forme interactive, position, fiche contact, modèle, fichier, réaction).
   *
   * ⚠️ Sans `idempotencyKey`, le SDK en pose une, fixe pour l'appel : les
   *    nouvelles tentatives sur 429/5xx ne peuvent donc jamais envoyer deux fois.
   *    La clé se donne dans l'entrée (`idempotencyKey`, corps) ou, à part, en
   *    option (`{ idempotencyKey }`, en-tête `Idempotency-Key`) ; pas les deux
   *    avec deux valeurs.
   * ⚠️ Un envoi refusé par Meta répond HTTP 200 ou 201 : lisez `message.status`
   *    (`failed`) et `message.errorInfo`, pas seulement l'absence d'exception.
   */
  send(input: SendInput, options: { idempotencyKey?: string } = {}): Promise<SendResult> {
    const headerKey = options.idempotencyKey?.trim()
    if (headerKey && input.idempotencyKey && input.idempotencyKey !== headerKey) {
      throw new TypeError('Nodium: `idempotencyKey` in the input and in the options differ — give one, or the same value.')
    }
    return this.http.request<SendResult>({
      method: 'POST', path: '/messages', tenant: this.tenant, idempotent: true,
      ...(headerKey ? { headers: { 'Idempotency-Key': headerKey } } : {}),
      body: headerKey ? { ...input } : { ...input, idempotencyKey: input.idempotencyKey ?? newIdempotencyKey() }
    })
  }

  /** Réagir à un message par un emoji (`""` pour retirer la réaction). Rien n'est rangé : `message` vaut `null`. */
  react(input: SendAddress & { channelId: string, messageId: string, emoji: string, idempotencyKey?: string }): Promise<SendResult> {
    return this.send({ ...input, type: 'reaction' })
  }

  /**
   * Relire un message, envoyé ou reçu : son statut courant (`sent`, `delivered`,
   * `read`, `failed`), `errorInfo`, ses identifiants et horodatages. Un message
   * d'un autre client ou d'un autre compte est « introuvable » (404).
   */
  get(id: string): Promise<Message> {
    return this.http.request({ method: 'GET', path: `/messages/${seg(id)}`, tenant: this.tenant })
  }

  /**
   * Une page d'un fil : les plus récents d'abord, chaque page rangée du plus
   * ancien au plus récent ; `nextCursor` remonte dans le passé.
   */
  list(conversationId: string, query: PageQuery = {}): Promise<Page<Message>> {
    return this.http.request({ method: 'GET', path: `/conversations/${seg(conversationId)}/messages`, query, tenant: this.tenant })
  }

  /** Tout le fil, page après page en remontant dans le passé, un message à la fois. */
  each(conversationId: string, query: Omit<PageQuery, 'cursor'> = {}): AsyncGenerator<Message, void, void> {
    return each(cursor => this.list(conversationId, { ...query, ...(cursor ? { cursor } : {}) }))
  }

  /** Les messages du client, toutes conversations confondues, le plus récent d'abord. */
  search(query: MessageQuery = {}): Promise<Page<Message>> {
    return this.http.request({ method: 'GET', path: '/messages', query, tenant: this.tenant })
  }
}

export class Conversations {
  constructor(private readonly http: Http, private readonly tenant: string | null) {}

  list(query: ConversationQuery = {}): Promise<Page<Conversation>> {
    return this.http.request({ method: 'GET', path: '/conversations', query, tenant: this.tenant })
  }

  each(query: Omit<ConversationQuery, 'cursor'> = {}) {
    return each(cursor => this.list({ ...query, ...(cursor ? { cursor } : {}) }))
  }

  get(id: string): Promise<Conversation> {
    return this.http.request({ method: 'GET', path: `/conversations/${seg(id)}`, tenant: this.tenant })
  }

  /** Envoyer l'accusé de lecture du dernier message reçu. */
  read(id: string): Promise<unknown> {
    return this.http.request({ method: 'POST', path: `/conversations/${seg(id)}/read`, tenant: this.tenant, idempotent: true })
  }

  /** Montrer « écrit… » au client. */
  typing(id: string): Promise<unknown> {
    return this.http.request({ method: 'POST', path: `/conversations/${seg(id)}/typing`, tenant: this.tenant, idempotent: true })
  }
}

export class Channels {
  constructor(private readonly http: Http, private readonly tenant: string | null) {}

  /** Les numéros du client visé ; `{ scope: 'account' }` = ceux de tous les clients. */
  async list(query: { scope?: 'account' } = {}): Promise<Channel[]> {
    return (await this.http.request<{ items: Channel[] }>({ method: 'GET', path: '/channels', query, tenant: this.tenant })).items
  }

  check(id: string): Promise<unknown> {
    return this.http.request({ method: 'POST', path: `/channels/${seg(id)}/check`, tenant: this.tenant })
  }

  /** Un numéro en détail : qualité, palier d'envoi, dernier contrôle de santé. */
  async get(id: string): Promise<ChannelDetail> {
    return (await this.http.request<{ channel: ChannelDetail }>({ method: 'GET', path: `/channels/${seg(id)}`, tenant: this.tenant })).channel
  }

  /**
   * Pourquoi un numéro ne reçoit pas ou n'envoie pas : chaque contrôle dit ce
   * qui ne va pas, qui peut le régler et quoi faire. Meta est interrogé en
   * direct (quelques secondes, 6 fois par minute au plus) ; rien n'est écrit.
   */
  diagnostic(id: string): Promise<NumberDiagnostic> {
    return this.http.request({ method: 'POST', path: `/channels/${seg(id)}/diagnostic`, tenant: this.tenant })
  }

  /** Allumer, éteindre ou renommer. */
  update(id: string, body: { isActive?: boolean, name?: string }): Promise<Channel> {
    return this.http.request({ method: 'PATCH', path: `/channels/${seg(id)}`, body, tenant: this.tenant })
  }

  /** La fiche de l'entreprise, lue chez Meta à chaque appel. */
  async profile(id: string): Promise<BusinessProfile> {
    return (await this.http.request<{ profile: BusinessProfile }>({ method: 'GET', path: `/channels/${seg(id)}/profile`, tenant: this.tenant })).profile
  }

  /** Ne change que les champs envoyés ; `websites` se remplace en bloc. */
  updateProfile(id: string, body: BusinessProfilePatch): Promise<{ updated: boolean }> {
    return this.http.request({ method: 'PATCH', path: `/channels/${seg(id)}/profile`, body, tenant: this.tenant })
  }

  /** Le nom d'affichage en service, et celui qui attend la revue de Meta. */
  async displayName(id: string): Promise<DisplayName> {
    return (await this.http.request<{ displayName: DisplayName }>({ method: 'GET', path: `/channels/${seg(id)}/display-name`, tenant: this.tenant })).displayName
  }

  /** Demande un nouveau nom d'affichage ; Meta le revoit, en général sous 48 h. */
  async requestDisplayName(id: string, body: { name: string }): Promise<DisplayName> {
    return (await this.http.request<{ displayName: DisplayName }>({ method: 'POST', path: `/channels/${seg(id)}/display-name`, body, tenant: this.tenant })).displayName
  }

  /** Le nom d'utilisateur du numéro, et ceux que Meta lui a réservés. */
  username(id: string): Promise<Username & { suggestions: string[] }> {
    return this.http.request({ method: 'GET', path: `/channels/${seg(id)}/username`, tenant: this.tenant })
  }

  /** Prend ou change le nom ; `transfer: true` le retire à un autre numéro du portefeuille. */
  setUsername(id: string, body: { username: string, transfer?: boolean }): Promise<Username> {
    return this.http.request({ method: 'PUT', path: `/channels/${seg(id)}/username`, body, tenant: this.tenant })
  }

  deleteUsername(id: string): Promise<{ deleted: boolean }> {
    return this.http.request({ method: 'DELETE', path: `/channels/${seg(id)}/username`, tenant: this.tenant })
  }
}

export class Templates {
  constructor(private readonly http: Http, private readonly tenant: string | null) {}

  /** Les modèles du client visé ; `scope: 'account'` : ceux de tous les clients (clé qui les voit tous). */
  async list(query: { scope?: 'account' } = {}): Promise<{ templates: Template[], summary: { total: number, draft: number, deployed: number } }> {
    return this.http.request({ method: 'GET', path: '/templates', query, tenant: this.tenant })
  }

  async get(id: string): Promise<{
    template: Template
    holes: TemplateHoles
    deployments: Array<{ wabaId: string | null, status: string, category: string | null, rejectionReason: string | null, submittedAt: string | null, reviewedAt: string | null }>
    usage: { sent: number, skipped: number }
    editable: boolean
    categoryLocked: boolean
  }> {
    return this.http.request({ method: 'GET', path: `/templates/${seg(id)}`, tenant: this.tenant })
  }

  /** Un brouillon du client visé : rien ne part chez Meta avant `deploy`. */
  create(input: TemplateInput): Promise<{ template: Template, holes: TemplateHoles }> {
    return this.http.request({ method: 'POST', path: '/templates', body: input, tenant: this.tenant })
  }

  /** Sauf pendant une revue chez Meta ; après un refus, on corrige puis on redéploie. */
  update(id: string, input: TemplateUpdate): Promise<{ template: Template, holes: TemplateHoles }> {
    return this.http.request({ method: 'PATCH', path: `/templates/${seg(id)}`, body: input, tenant: this.tenant })
  }

  delete(id: string): Promise<{ deleted: boolean }> {
    return this.http.request({ method: 'DELETE', path: `/templates/${seg(id)}`, tenant: this.tenant })
  }

  /**
   * Le déposer dans chaque compte WhatsApp de son client. Ne fait que ce
   * qu'il reste à faire : on peut le rejouer.
   * ⚠️ Geste externe et définitif : le nom est réservé chez Meta.
   */
  deploy(id: string): Promise<{ template: Template, results: DeployOutcome[] }> {
    return this.http.request({ method: 'POST', path: `/templates/${seg(id)}/deploy`, tenant: this.tenant, idempotent: true })
  }

  /** Redemander à Meta où il en est, compte WhatsApp par compte WhatsApp. */
  refresh(id: string): Promise<{ template: Template, changed: number }> {
    return this.http.request({ method: 'POST', path: `/templates/${seg(id)}/refresh`, tenant: this.tenant, idempotent: true })
  }

  /** Recopier les modèles déjà présents chez Meta ; `scope: 'account'` : chez tous les clients. */
  import(query: { scope?: 'account' } = {}): Promise<{ count: number, skipped: Array<{ client: string, reason: string }> }> {
    return this.http.request({ method: 'POST', path: '/templates/import', query, tenant: this.tenant, idempotent: true })
  }
}

export class Contacts {
  constructor(private readonly http: Http, private readonly tenant: string | null) {}

  list(query: PageQuery & ContactExportQuery = {}): Promise<Page<Contact>> {
    return this.http.request({ method: 'GET', path: '/contacts', query, tenant: this.tenant })
  }

  each(query: Omit<PageQuery, 'cursor'> & ContactExportQuery = {}): AsyncGenerator<Contact, void, void> {
    return each(cursor => this.list({ ...query, ...(cursor ? { cursor } : {}) }))
  }

  async get(id: string): Promise<Contact> {
    return (await this.http.request<{ contact: Contact }>({ method: 'GET', path: `/contacts/${seg(id)}`, tenant: this.tenant })).contact
  }

  async create(input: ContactInput): Promise<Contact> {
    return (await this.http.request<{ contact: Contact }>({ method: 'POST', path: '/contacts', body: input, tenant: this.tenant })).contact
  }

  async update(id: string, input: ContactUpdate): Promise<Contact> {
    return (await this.http.request<{ contact: Contact }>({ method: 'PATCH', path: `/contacts/${seg(id)}`, body: input, tenant: this.tenant })).contact
  }

  /** Les contacts en CSV (UTF-8, 10 000 lignes au plus), avec les filtres de `list`. */
  async exportCsv(query: ContactExportQuery = {}): Promise<string> {
    const response = await this.http.raw({ path: '/contacts/export', accept: 'text/csv', tenant: this.tenant, query })
    return await response.text()
  }

  /** Effacer une personne, pour de bon. `confirmName` : le nom ou le numéro du contact. */
  erase(id: string, confirmName: string): Promise<unknown> {
    return this.http.request({ method: 'DELETE', path: `/privacy/contacts/${seg(id)}`, body: { confirmName }, tenant: this.tenant })
  }
}

export class Webhooks {
  constructor(private readonly http: Http, private readonly tenant: string | null) {}

  /** Les abonnements, le catalogue des événements et les dernières livraisons. */
  list(): Promise<{ events: string[], subscriptions: WebhookSubscription[], deliveries: WebhookDelivery[] }> {
    return this.http.request({ method: 'GET', path: '/webhooks', tenant: this.tenant })
  }

  /** Un abonnement ; le secret ne se relit jamais. */
  async get(id: string): Promise<WebhookSubscription> {
    return (await this.http.request<{ subscription: WebhookSubscription }>({ method: 'GET', path: `/webhooks/${seg(id)}`, tenant: this.tenant })).subscription
  }

  /** ⚠️ Le secret de signature (`secret`) ne se montre qu'ici. */
  create(input: WebhookInput): Promise<{ id: string, secret: string }> {
    return this.http.request({ method: 'POST', path: '/webhooks', body: input, tenant: this.tenant })
  }

  update(id: string, input: WebhookUpdate): Promise<WebhookSubscription> {
    return this.http.request({ method: 'PATCH', path: `/webhooks/${seg(id)}`, body: input, tenant: this.tenant })
  }

  delete(id: string): Promise<unknown> {
    return this.http.request({ method: 'DELETE', path: `/webhooks/${seg(id)}`, tenant: this.tenant })
  }

  /** Un nouveau secret ; l'ancien signe encore un moment (`previousValidUntil`). */
  rotateSecret(id: string): Promise<{ secret: string, previousValidUntil: string }> {
    return this.http.request({ method: 'POST', path: `/webhooks/${seg(id)}/rotate-secret`, tenant: this.tenant })
  }

  test(id: string): Promise<{ ok: boolean, status: number | null, ms: number, error: string | null }> {
    return this.http.request({ method: 'POST', path: `/webhooks/${seg(id)}/test`, tenant: this.tenant })
  }

  deliveries(query: WebhookDeliveryQuery = {}): Promise<Page<WebhookDelivery>> {
    return this.http.request({ method: 'GET', path: '/webhooks/deliveries', query, tenant: this.tenant })
  }

  eachDelivery(query: Omit<WebhookDeliveryQuery, 'cursor'> = {}): AsyncGenerator<WebhookDelivery, void, void> {
    return each(cursor => this.deliveries({ ...query, ...(cursor ? { cursor } : {}) }))
  }

  redeliver(deliveryId: string): Promise<WebhookDelivery> {
    return this.http.request({ method: 'POST', path: `/webhooks/deliveries/${seg(deliveryId)}/redeliver`, tenant: this.tenant })
  }
}

export class Broadcasts {
  constructor(private readonly http: Http, private readonly tenant: string | null) {}

  /** Les dernières diffusions, et les modèles approuvés ; `{ scope: 'account' }` = tous les clients. */
  list(query: { scope?: 'account' } = {}): Promise<{ items: Broadcast[], templates: Array<Record<string, unknown>> }> {
    return this.http.request({ method: 'GET', path: '/broadcasts', query, tenant: this.tenant })
  }

  async get(id: string): Promise<Broadcast> {
    return (await this.http.request<{ broadcast: Broadcast }>({ method: 'GET', path: `/broadcasts/${seg(id)}`, tenant: this.tenant })).broadcast
  }

  /** Qui la recevrait, et qui serait mis de côté. */
  preview(input: { contactIds?: string[], allOptIn?: boolean }): Promise<BroadcastPreview> {
    return this.http.request({ method: 'POST', path: '/broadcasts/preview', body: input, tenant: this.tenant })
  }

  send(input: BroadcastInput): Promise<{ id: string, status: Broadcast['status'], counts: Record<string, number> }> {
    return this.http.request({ method: 'POST', path: '/broadcasts', body: input, tenant: this.tenant })
  }

  cancel(id: string): Promise<{ withdrawn: number, broadcast: Broadcast }> {
    return this.http.request({ method: 'POST', path: `/broadcasts/${seg(id)}/cancel`, tenant: this.tenant })
  }

  /** Lance un brouillon, ou change l'heure d'une diffusion programmée ; sans `scheduledAt`, tout de suite. */
  async launch(id: string, body: { scheduledAt?: string } = {}): Promise<Broadcast> {
    return (await this.http.request<{ broadcast: Broadcast }>({ method: 'POST', path: `/broadcasts/${seg(id)}/send`, body, tenant: this.tenant })).broadcast
  }

  /** Les destinataires et l'issue de chacun, par pages. */
  recipients(id: string, query: PageQuery = {}): Promise<Page<BroadcastRecipient>> {
    return this.http.request({ method: 'GET', path: `/broadcasts/${seg(id)}/recipients`, query, tenant: this.tenant })
  }

  /** Ajoute des destinataires à une diffusion qui n'est pas partie. */
  addRecipients(id: string, input: { contactIds?: string[], allOptIn?: boolean }): Promise<{ counts: Record<string, number> }> {
    return this.http.request({ method: 'POST', path: `/broadcasts/${seg(id)}/recipients`, body: input, tenant: this.tenant })
  }

  /** Retire tous les destinataires d'une diffusion qui n'est pas partie ; programmée, elle redevient brouillon. */
  clearRecipients(id: string): Promise<{ removed: number }> {
    return this.http.request({ method: 'DELETE', path: `/broadcasts/${seg(id)}/recipients`, tenant: this.tenant })
  }

  /** Reprend une diffusion en pause (`status: 'paused'`) une fois la cause réglée. */
  async resume(id: string): Promise<Broadcast> {
    return (await this.http.request<{ broadcast: Broadcast }>({ method: 'POST', path: `/broadcasts/${seg(id)}/resume`, tenant: this.tenant })).broadcast
  }
}

export class Flows {
  constructor(private readonly http: Http, private readonly tenant: string | null) {}

  /** Les formulaires du client, le plus récemment modifié d'abord. */
  async list(query: FlowQuery = {}): Promise<Flow[]> {
    return (await this.http.request<{ items: Flow[] }>({ method: 'GET', path: '/flows', query, tenant: this.tenant })).items
  }

  /** Le formulaire, sa dernière version et son point d'accès (`null` s'il est statique). */
  get(id: string): Promise<{ flow: Flow, version: FlowVersion | null, dataEndpoint: FlowDataEndpoint | null }> {
    return this.http.request({ method: 'GET', path: `/flows/${seg(id)}`, tenant: this.tenant })
  }

  /** Un brouillon chez Meta. Un JSON invalide s'enregistre aussi : lire `validationErrors`. */
  create(input: FlowInput): Promise<{ flow: Flow, version: FlowVersion, validationErrors: FlowValidationError[] }> {
    return this.http.request({ method: 'POST', path: '/flows', body: input, tenant: this.tenant })
  }

  /** Renommer ou changer les catégories. */
  async update(id: string, body: { name?: string, categories?: FlowInput['categories'] }): Promise<Flow> {
    return (await this.http.request<{ flow: Flow }>({ method: 'PATCH', path: `/flows/${seg(id)}`, body, tenant: this.tenant })).flow
  }

  /** ⚠️ Un brouillon seulement : un formulaire publié se déprécie. */
  delete(id: string): Promise<{ deleted: boolean }> {
    return this.http.request({ method: 'DELETE', path: `/flows/${seg(id)}`, tenant: this.tenant })
  }

  /** Relire chez Meta les Flows du client (ceux dessinés dans WhatsApp Manager y compris). */
  sync(): Promise<{ items: Flow[], synced: number }> {
    return this.http.request({ method: 'POST', path: '/flows/sync', tenant: this.tenant })
  }

  /** L'historique, sans le JSON de chaque version. */
  async versions(id: string): Promise<Array<Omit<FlowVersion, 'flowJson'>>> {
    return (await this.http.request<{ items: Array<Omit<FlowVersion, 'flowJson'>> }>({ method: 'GET', path: `/flows/${seg(id)}/versions`, tenant: this.tenant })).items
  }

  async version(id: string, versionId: string): Promise<FlowVersion> {
    return (await this.http.request<{ version: FlowVersion }>({ method: 'GET', path: `/flows/${seg(id)}/versions/${seg(versionId)}`, tenant: this.tenant })).version
  }

  /** Enregistrer un JSON (10 Mo au plus) : Meta le valide. Un brouillon seulement. */
  saveVersion(id: string, flowJson: Record<string, unknown>): Promise<{ version: FlowVersion, validationErrors: FlowValidationError[] }> {
    return this.http.request({ method: 'POST', path: `/flows/${seg(id)}/versions`, body: { flowJson }, tenant: this.tenant })
  }

  /** L'adresse de l'aperçu que Meta rend (environ trente jours). */
  preview(id: string): Promise<{ previewUrl: string, expiresAt: string | null }> {
    return this.http.request({ method: 'GET', path: `/flows/${seg(id)}/preview`, tenant: this.tenant })
  }

  /** ⚠️ Définitif : un Flow publié ne se modifie plus ni ne se dépublie. */
  async publish(id: string): Promise<Flow> {
    return (await this.http.request<{ flow: Flow }>({ method: 'POST', path: `/flows/${seg(id)}/publish`, tenant: this.tenant })).flow
  }

  /** Retirer un Flow publié de l'usage ; on ne revient pas en arrière. */
  async deprecate(id: string): Promise<Flow> {
    return (await this.http.request<{ flow: Flow }>({ method: 'POST', path: `/flows/${seg(id)}/deprecate`, tenant: this.tenant })).flow
  }

  /** Une copie en brouillon : le chemin pour changer un Flow publié. */
  async duplicate(id: string, body: { name?: string } = {}): Promise<Flow> {
    return (await this.http.request<{ flow: Flow }>({ method: 'POST', path: `/flows/${seg(id)}/duplicate`, body, tenant: this.tenant })).flow
  }

  async dataEndpoint(id: string): Promise<FlowDataEndpoint | null> {
    return (await this.http.request<{ dataEndpoint: FlowDataEndpoint | null }>({ method: 'GET', path: `/flows/${seg(id)}/data-endpoint`, tenant: this.tenant })).dataEndpoint
  }

  /**
   * Rendre le Flow dynamique : Meta appelle Nodium, qui relaie vers votre `url`
   * (https, signé comme un webhook). Un brouillon seulement.
   * ⚠️ Le secret de signature (`secret`) ne se montre qu'ici.
   */
  setDataEndpoint(id: string, url: string): Promise<{ dataEndpoint: FlowDataEndpoint, secret: string, unregisteredChannels: string[] }> {
    return this.http.request({ method: 'PUT', path: `/flows/${seg(id)}/data-endpoint`, body: { url }, tenant: this.tenant })
  }

  /** Redevenir statique. Un brouillon seulement. */
  removeDataEndpoint(id: string): Promise<{ removed: boolean }> {
    return this.http.request({ method: 'DELETE', path: `/flows/${seg(id)}/data-endpoint`, tenant: this.tenant })
  }

  /** Les 100 derniers appels de Meta, sur trente jours. Jamais le contenu échangé. */
  async invocations(id: string): Promise<FlowInvocation[]> {
    return (await this.http.request<{ items: FlowInvocation[] }>({ method: 'GET', path: `/flows/${seg(id)}/invocations`, tenant: this.tenant })).items
  }

  /** Ce que les contacts ont saisi, le plus récent d'abord (le temps de la conservation du contenu). */
  responses(query: FlowResponseQuery = {}): Promise<Page<FlowResponse>> {
    return this.http.request({ method: 'GET', path: '/flow-responses', query, tenant: this.tenant })
  }

  eachResponse(query: Omit<FlowResponseQuery, 'cursor'> = {}): AsyncGenerator<FlowResponse, void, void> {
    return each(cursor => this.responses({ ...query, ...(cursor ? { cursor } : {}) }))
  }
}

export class Media {
  constructor(private readonly http: Http, private readonly tenant: string | null) {}

  /** Les fichiers dont Nodium garde une copie, le plus récent d'abord. */
  list(query: MediaQuery = {}): Promise<Page<MediaItem>> {
    return this.http.request({ method: 'GET', path: '/media', query, tenant: this.tenant })
  }

  each(query: Omit<MediaQuery, 'cursor'> = {}): AsyncGenerator<MediaItem, void, void> {
    return each(cursor => this.list({ ...query, ...(cursor ? { cursor } : {}) }))
  }

  /**
   * Déposer un fichier à envoyer : rend un `mediaId`, valable 7 jours (`expiresAt`),
   * que `messages.send` cite (`type` = `kind`, `mediaId`). Le même `mediaId` peut
   * partir vers autant de personnes qu'on veut. 4 Mo au plus.
   *
   * ⚠️ Un dépôt rejoué après une panne ne crée qu'un fichier de plus, jamais un
   *    message : il est donc réessayé comme une lecture.
   */
  upload(file: Blob | ArrayBuffer | Uint8Array, options: MediaUploadOptions = {}): Promise<MediaUpload> {
    const blob = file instanceof Blob
      ? (options.contentType && options.contentType !== file.type ? new Blob([file], { type: options.contentType }) : file)
      : new Blob([file as BlobPart], { type: options.contentType ?? 'application/octet-stream' })
    const form = new FormData()
    form.append('file', blob, options.filename ?? (blob as File).name ?? 'file')
    return this.http.request<MediaUpload>({ method: 'POST', path: '/media', form, tenant: this.tenant, idempotent: true })
  }

  /** Le fichier d'un message, tel que Nodium l'a gardé. */
  download(messageId: string): Promise<Response> {
    return this.http.raw({ path: `/messages/${seg(messageId)}/media`, tenant: this.tenant })
  }

  /** Retirer la copie du fichier (le message reste). ⚠️ Irrécupérable. */
  remove(messageId: string): Promise<{ removed: boolean }> {
    return this.http.request({ method: 'DELETE', path: `/media/${seg(messageId)}`, tenant: this.tenant })
  }
}

export class Stats {
  constructor(private readonly http: Http, private readonly tenant: string | null) {}

  /** Envoyé, livré, lu, répondu, en échec, écarté : par jour et par modèle (ou diffusion). */
  delivery(query: DeliveryStatsQuery = {}): Promise<DeliveryStats> {
    return this.http.request({ method: 'GET', path: '/stats/delivery', query, tenant: this.tenant })
  }
}

export class Events {
  constructor(private readonly http: Http, private readonly tenant: string | null) {}

  /**
   * Le journal d'événements : tout ce que Nodium a émis, numéroté, relu depuis
   * un curseur. Le webhook est une sonnette, ce journal est la vérité.
   *
   * · sans `after` : `data` est vide et `next_after` est la tête du journal,
   *   à garder comme premier curseur ;
   * · avec `after` (le dernier `next_after` gardé) : les événements suivants, au
   *   plus `limit` (1 à 500, 100 par défaut). Recommencez tant que `next_after`
   *   avance ; gardez-le une fois la page rangée.
   *
   * ```ts
   * let after = (await nodium.events.list()).next_after
   * for (;;) {
   *   const page = await nodium.events.list(after)
   *   for (const entry of page.data) handle(entry) // entry.id dédoublonne
   *   if (page.next_after === after) break
   *   after = page.next_after
   * }
   * ```
   *
   * ⚠️ Une clé non épinglée lit tout le compte ; une clé épinglée, son
   * client seulement. Un curseur plus vieux que le journal (30 jours) rend 410
   * `cursor_expired` : repartez de `after = 0`.
   */
  list(after?: number, limit?: number): Promise<EventLogPage> {
    return this.http.request({ method: 'GET', path: '/events', query: { after, limit }, tenant: this.tenant })
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Ce qui agit sur le COMPTE
// ─────────────────────────────────────────────────────────────────────────────

export class Tenants {
  constructor(private readonly http: Http) {}

  /** Les clients du compte, les plus récents d'abord. `externalId` retrouve le vôtre. */
  list(query: PageQuery & { externalId?: string } = {}): Promise<Page<Tenant>> {
    return this.http.request({ method: 'GET', path: '/tenants', query })
  }

  each(query: { externalId?: string, limit?: number } = {}): AsyncGenerator<Tenant, void, void> {
    return each(cursor => this.list({ ...query, ...(cursor ? { cursor } : {}) }))
  }

  /** Par l'id de Nodium ou par votre `externalId`. */
  async get(id: string): Promise<Tenant> {
    return (await this.http.request<{ tenant: Tenant }>({ method: 'GET', path: `/tenants/${seg(id)}` })).tenant
  }

  /**
   * Ajouter un client. Avec `{ connectLink }`, le lien hébergé où il branche
   * son WhatsApp est créé dans la foulée et rendu dans `connectLink.url`.
   *
   * ⚠️ `409 tenant_exists` : votre `externalId` existe déjà ; l'id du client
   *    est dans `error.data.tenantId`.
   */
  create(input: TenantInput, options: { connectLink: ConnectLinkInput | true }): Promise<TenantWithLink>
  create(input: TenantInput): Promise<Tenant>
  async create(input: TenantInput, options?: { connectLink: ConnectLinkInput | true }): Promise<Tenant | TenantWithLink> {
    const { tenant } = await this.http.request<{ tenant: Tenant }>({ method: 'POST', path: '/tenants', body: input })
    if (!options?.connectLink) return tenant
    const link = await this.connectLink(tenant.id, options.connectLink === true ? {} : options.connectLink)
    return { ...tenant, connectLink: link }
  }

  async update(id: string, input: TenantUpdate): Promise<Tenant> {
    return (await this.http.request<{ tenant: Tenant }>({ method: 'PATCH', path: `/tenants/${seg(id)}`, body: input })).tenant
  }

  /** Fermer un client : ses numéros s'éteignent, ses clés se révoquent. Rien n'est effacé. */
  close(id: string): Promise<TenantDeleted> {
    return this.http.request({ method: 'DELETE', path: `/tenants/${seg(id)}` })
  }

  /** Le lien à envoyer à votre client. ⚠️ Il ne se montre qu'ici, et ne sert qu'une fois. */
  connectLink(id: string, input: ConnectLinkInput = {}): Promise<ConnectLink> {
    return this.http.request({ method: 'POST', path: `/tenants/${seg(id)}/connect-links`, body: input })
  }

  /** Les numéros du client : c'est ce qu'on relit après le retour du lien. */
  async channels(id: string): Promise<Channel[]> {
    return (await this.http.request<{ items: Channel[] }>({ method: 'GET', path: `/tenants/${seg(id)}/channels` })).items
  }
}

export class ConnectLinks {
  constructor(private readonly http: Http) {}

  /** Les liens hébergés du compte, le plus récent d'abord. Jamais leur adresse. */
  list(query: ConnectLinkQuery = {}): Promise<Page<ConnectLinkItem>> {
    return this.http.request({ method: 'GET', path: '/connect-links', query })
  }

  each(query: Omit<ConnectLinkQuery, 'cursor'> = {}): AsyncGenerator<ConnectLinkItem, void, void> {
    return each(cursor => this.list({ ...query, ...(cursor ? { cursor } : {}) }))
  }

  /** Un lien pas encore utilisé cesse de servir aussitôt. */
  revoke(id: string): Promise<{ revoked: boolean }> {
    return this.http.request({ method: 'DELETE', path: `/connect-links/${seg(id)}` })
  }

  /** Prolonger un lien en attente (`expiresInDays` depuis maintenant) ou changer son retour : l'adresse envoyée reste bonne. */
  update(id: string, input: ConnectLinkUpdate): Promise<ConnectLinkUpdated> {
    return this.http.request({ method: 'PATCH', path: `/connect-links/${seg(id)}`, body: input })
  }
}

export class ApiRequests {
  constructor(private readonly http: Http, private readonly tenant: string | null) {}

  /** Les appels faits avec les clés du compte sur 30 jours, le plus récent d'abord : pour voir pourquoi un appel a échoué. */
  list(query: ApiRequestQuery = {}): Promise<Page<ApiRequest>> {
    return this.http.request({ method: 'GET', path: '/api-requests', query, tenant: this.tenant })
  }

  each(query: Omit<ApiRequestQuery, 'cursor'> = {}): AsyncGenerator<ApiRequest, void, void> {
    return each(cursor => this.list({ ...query, ...(cursor ? { cursor } : {}) }))
  }
}

export class Sandbox {
  constructor(private readonly http: Http) {}

  /** Le numéro d'essai partagé, le code pour s'y relier et les téléphones reliés. */
  get(): Promise<SandboxState> {
    return this.http.request({ method: 'GET', path: '/sandbox' })
  }
}

export class Keys {
  constructor(private readonly http: Http) {}

  /**
   * La clé qui appelle : son compte, si elle est épinglée à un client, quand
   * elle expire. Toute clé peut l'appeler. Une clé qui agit pour tous les
   * clients du compte est `pinned: false`.
   */
  current(): Promise<CurrentApiKey> {
    return this.http.request({ method: 'GET', path: '/keys/current' })
  }

  async list(): Promise<ApiKey[]> {
    return (await this.http.request<{ items: ApiKey[] }>({ method: 'GET', path: '/keys' })).items
  }

  /** ⚠️ Le secret (`token`) ne se montre qu'ici. */
  create(input: ApiKeyInput = {}): Promise<CreatedApiKey> {
    return this.http.request({ method: 'POST', path: '/keys', body: input })
  }

  /** `confirmSelf` : la clé qui appelle peut se révoquer elle-même, à condition de le dire. */
  revoke(id: string, options: { confirmSelf?: boolean } = {}): Promise<{ revoked: boolean, key: ApiKey }> {
    return this.http.request({ method: 'DELETE', path: `/keys/${seg(id)}`, query: options })
  }
}

export class Billing {
  constructor(private readonly http: Http) {}

  /** Ce que le mois va coûter : offre, clients actifs, quota, total estimé. */
  summary(): Promise<BillingSummary> {
    return this.http.request({ method: 'GET', path: '/billing/summary' })
  }
}

export { queryString }
