/**
 * Les formes de l'API, tirées de `shared/apiSchemas.json` et des `apiDoc` des
 * routes. Rien n'y est inventé : ce qui n'a pas de route n'a pas de type.
 * Les dates sont des chaînes ISO 8601, comme l'API les rend.
 */
import type { NodiumEvent } from './webhooks'

/**
 * Une page de liste : `nextCursor` va dans `cursor` pour la suivante ; `null` à
 * la dernière. `total` n'est rendu que sur la première page, quand la liste le
 * compte.
 */
export interface Page<T> {
  items: T[]
  nextCursor: string | null
  hasMore: boolean
  total?: number | null
}

export interface PageQuery {
  limit?: number
  cursor?: string
}

/** Les filtres de `messages.search`. */
export interface MessageQuery extends PageQuery {
  channelId?: string
  contactId?: string
  direction?: 'inbound' | 'outbound'
  status?: 'scheduled' | 'queued' | 'sending' | 'sent' | 'delivered' | 'read' | 'failed'
}

// ── Clients ────────────────────────────────────────────────────────────────

export interface Tenant {
  id: string
  externalId: string | null
  name: string
  slug: string
  status: 'active' | 'suspended'
  locale: 'fr' | 'en'
  timezone: string
  whatsapp: { status: 'connected' | 'link_sent' | 'not_connected', numbers: number, displayPhone: string | null }
  /** Le dernier lien de branchement : son état seulement, jamais son adresse. */
  connectLink: {
    state: 'pending' | 'used' | 'expired'
    expiresAt: string
    usedAt: string | null
    createdAt: string
    /** La première ouverture par votre client, ou `null`. */
    openedAt: string | null
    /** La dernière issue d'une tentative par ce lien, ou `null` avant la première. */
    lastAttempt: { at: string, status: 'completed' | 'failed' | 'abandoned', code: string | null, step: string | null } | null
  } | null
  /** La fiche « Votre entreprise » rangée : par vous (`tenants.update`) ou par votre client sur la page. Chaînes vides tant que rien n'est saisi. */
  business: TenantBusiness & { complete: boolean }
  activeThisMonth: boolean
  eventsThisMonth: number
  createdAt: string
  updatedAt: string
}

export interface TenantInput {
  name: string
  /** Votre identifiant du client : unique dans le compte, il rend l'appel rejouable. */
  externalId?: string
  locale?: 'fr' | 'en'
  timezone?: string
}

export interface TenantUpdate {
  name?: string
  externalId?: string | null
  locale?: 'fr' | 'en'
  timezone?: string
  /** Remplit la fiche « Votre entreprise » : chaque champ donné remplace le sien, `''` l'efface. */
  business?: Partial<TenantBusiness>
}

/** Ce que la fenêtre de Meta demande de l'entreprise, saisi d'avance. */
export interface TenantBusiness {
  name: string
  /** Le nom affiché dans WhatsApp, 3 caractères au moins. */
  displayName: string
  email: string
  /** Le site, ou la page Facebook ou Instagram. */
  website: string
  street: string
  postalCode: string
  city: string
  /** Code pays ISO 3166-1 alpha-2 (`FR`). */
  country: string
  /** Le secteur, mêmes valeurs que le profil d'un numéro (`RETAIL`…). */
  category: string
  description: string
}

export interface ConnectLinkInput {
  /** https:// seulement : où renvoyer votre client après le branchement. */
  redirectUrl?: string
  /** 1 à 30, défaut 7. */
  expiresInDays?: number
  /** Fixe le mode : la page ne pose plus la question. Absent : votre client choisit. */
  mode?: 'dedicated' | 'coexistence'
  /** Le seul numéro que ce lien branche, au format international (`+33612345678`). */
  phoneNumber?: string
  /** Ce que la fiche « Votre entreprise » de la page pré-remplit ; votre client vérifie. */
  prefill?: ConnectLinkPrefill
}

/** Chaque champ remplit le sien dans la fiche « Votre entreprise », qui remplit ensuite la fenêtre de Meta. */
export interface ConnectLinkPrefill {
  /** Le nom de l'entreprise ; sans lui, le nom du client. */
  name?: string
  /** Le nom affiché dans WhatsApp, 3 caractères au moins ; sans lui, `name`. */
  displayName?: string
  /** Le site, ou la page Facebook ou Instagram : https://, ou un domaine nu qui le reçoit. */
  website?: string
  email?: string
  /** Code pays ISO 3166-1 alpha-2 (`FR`). */
  country?: string
  address?: { street?: string, city?: string, postalCode?: string }
  /** Le secteur du profil WhatsApp (mêmes valeurs que le profil d'un canal). */
  category?: string
  /** Une phrase sur ce que fait l'entreprise, pour le profil WhatsApp, 512 caractères au plus. */
  description?: string
}

/** Le lien hébergé : son adresse ne se montre qu'ici, à la création. */
export interface ConnectLink {
  id: string
  url: string
  expiresAt: string
  redirectUrl: string | null
  /** Le mode fixé, ou `null` : votre client choisit. */
  mode: 'dedicated' | 'coexistence' | null
  /** Le seul numéro que ce lien branche, ou `null`. */
  phoneNumber: string | null
}

export type TenantWithLink = Omit<Tenant, 'connectLink'> & { connectLink: ConnectLink }

export interface TenantDeleted {
  deleted: boolean
  channelsSwitchedOff: number
  keysRevoked: number
}

// ── Clés ───────────────────────────────────────────────────────────────────

export interface ApiKey {
  id: string
  label: string
  keyPrefix: string
  clientId: string | null
  clientName: string | null
  isActive: boolean
  createdBy: string | null
  lastUsedAt: string | null
  revokedAt: string | null
  /** Quand elle cesse de servir ; `null` = n'expire jamais. Passé ce jour, `isActive` vaut `false` et l'appel rend 401 `api_key_expired`. */
  expiresAt: string | null
  createdAt: string
}

export interface ApiKeyInput {
  label?: string
  /** Épingle la clé à un client : son id, ou votre `externalId`. */
  clientId?: string
  /** La clé cesse de servir après ce nombre de jours (1 à 3650). Absent : elle n'expire jamais. */
  expiresInDays?: number
}

/** Le secret (`token`) ne se montre qu'ici. */
export interface CreatedApiKey {
  key: ApiKey
  token: string
}

/** La clé qui appelle, telle que `keys.current()` la décrit. Jamais son secret ni son préfixe. */
export interface CurrentApiKey {
  id: string
  /** Le nom donné à la clé, peut-être vide. */
  label: string
  accountId: string
  accountName: string
  /** Vrai : épinglée à un client, elle n'en sort pas. Faux : elle agit sur tous les clients du compte. */
  pinned: boolean
  /** Le client où elle est épinglée (`isHome` : « Mon entreprise ») ; `null` sans épingle. */
  client: { id: string, name: string, isHome: boolean } | null
  /** Quand elle cesse de servir ; `null` = n'expire jamais. */
  expiresAt: string | null
}

// ── Le journal d'événements ─────────────────────────────────────────────────

/** Une ligne du journal d'événements : l'enveloppe d'un webhook, et sa position (`seq`). */
export type EventLogEntry = NodiumEvent & { seq: number }

/**
 * Une page du journal d'événements. `next_after` va dans `after` de l'appel
 * suivant ; tant qu'il avance, il reste peut-être des lignes (une page peut
 * être vide et avancer : les événements d'autres clients sont sautés).
 */
export interface EventLogPage {
  data: EventLogEntry[]
  next_after: number
}

// ── Messages ───────────────────────────────────────────────────────────────

export type MessageStatus = 'queued' | 'sending' | 'sent' | 'delivered' | 'read' | 'failed'

/**
 * Un refus du fournisseur expliqué. `actor` dit qui agit : `you` (votre code ou
 * votre console), `client` (le titulaire du numéro : `action` lui est adressée,
 * à lui transmettre telle quelle), `nodium`, ou `wait` (refus passager).
 */
export interface MessageErrorInfo {
  code: number
  title: string
  action: string
  actor: 'you' | 'client' | 'nodium' | 'wait'
}

export interface Message {
  id: string
  conversationId: string
  channelType: 'whatsapp'
  direction: 'inbound' | 'outbound'
  sender: 'contact' | 'api' | 'user' | 'system'
  senderName: string | null
  apiKeyId: string | null
  type: string
  textContent: string | null
  mediaUrl: string | null
  status: MessageStatus
  providerMessageId: string | null
  error: string | null
  /**
   * Le refus expliqué quand `status` vaut `failed` et que le fournisseur a donné un code ;
   * `null` sinon. ⚠️ Un envoi refusé répond HTTP 200 ou 201 : testez `status`.
   */
  errorInfo?: MessageErrorInfo | null
  form: Record<string, unknown> | null
  reply: Record<string, unknown> | null
  location: Record<string, unknown> | null
  /** `phone` : écrit depuis l'application WhatsApp Business d'un numéro en coexistence ; sinon `null`. */
  origin?: 'phone' | null
  /** Vrai : repris de l'historique du téléphone (coexistence), non reçu en direct. */
  imported?: boolean
  createdAt: string
}

export interface SendResult {
  /** Le fil du message : ouvert par cet appel, ou repris. */
  conversationId: string
  /** `null` pour une réaction : elle se pose sur un message, elle n'en crée pas. */
  message: Message | null
  /** Vrai quand `idempotencyKey` avait déjà servi : rien n'est reparti. */
  duplicate?: boolean
}

/**
 * La personne à qui l'on écrit : son numéro (`to`, E.164) OU son identifiant
 * WhatsApp (`recipient`, `wa:…`), pour un contact qui n'expose pas son numéro.
 * Jamais les deux.
 */
export type SendAddress =
  | { to: string, recipient?: undefined }
  | { recipient: string, to?: undefined }

/** Ce que tout envoi porte. */
interface SendBase {
  /** Le numéro qui parle (`channels.list()`). */
  channelId: string
  /** Votre clé anti-doublon (8 à 200 caractères). Absente, le SDK en tire une, fixe pour tout l'appel. */
  idempotencyKey?: string
  /** Citer un message précédent de la conversation (son identifiant Nodium). Pas pour une réaction. */
  replyToId?: string
  /** Rendre la main aussitôt (HTTP 202) ; le message part dans la minute. */
  queue?: boolean
  /** ISO 8601, au moins une minute devant : envoi différé. */
  scheduledAt?: string
}

/**
 * La valeur d'un bouton dynamique d'un modèle. `index` : sa position dans le
 * modèle, à partir de 0. `url` : le suffixe du lien (le `{{1}}` de son adresse) ;
 * `quick_reply` : la charge renvoyée à l'appui ; `copy_code` : le code à copier
 * (15 caractères au plus) ; `flow` : le bouton qui ouvre un formulaire — votre
 * `flowToken` (rendu avec la réponse) et les `data` du premier écran, l'un et
 * l'autre facultatifs.
 */
export type TemplateButtonValue =
  | { index: number, type: 'url', text: string }
  | { index: number, type: 'quick_reply', payload: string }
  | { index: number, type: 'copy_code', code: string }
  | { index: number, type: 'flow', flowToken?: string, data?: Record<string, unknown> }

/**
 * Le bouton d'un modèle qui ouvre un formulaire WhatsApp (Flow) : il s'ouvre
 * ainsi hors de la fenêtre de 24 h, et dans une diffusion. Un seul par modèle ;
 * le Flow doit être publié au déploiement.
 */
export interface TemplateFlowButton {
  type: 'FLOW'
  /** Le libellé, 25 caractères au plus. */
  text: string
  /** Le Flow (`flows.list()`), du client du modèle. */
  flowId: string
  /** L'écran d'ouverture ; absent = le premier. Ignoré pour un Flow dynamique. */
  screen?: string | null
}

/** Du texte libre : dans les 24 h qui suivent le dernier message de la personne. */
export interface SendText extends SendBase {
  type: 'text'
  /** 4 096 caractères au plus. */
  text: string
}

/** Une forme interactive : boutons, liste, demande de position, formulaire Flow. Texte libre pour Meta. */
export interface SendInteractive extends SendBase {
  type: 'interactive'
  form: InteractiveForm
  /** Le corps de la forme, quand `form.body` est absent. */
  text?: string
}

/** Une position. */
export interface SendLocation extends SendBase {
  type: 'location'
  location: { latitude: number, longitude: number, name?: string, address?: string }
}

/** Une fiche contact (Meta n'en accepte qu'une par message). */
export interface SendContacts extends SendBase {
  type: 'contacts'
  contacts: Array<{ name: Record<string, unknown>, phones?: unknown[], emails?: unknown[] }>
}

/**
 * Un modèle approuvé : le seul envoi possible hors de la fenêtre de 24 h, donc
 * le seul pour écrire en premier à quelqu'un qui n'a jamais écrit.
 */
export interface SendTemplate extends SendBase {
  type: 'template'
  templateId?: string
  templateName?: string
  templateLanguage?: string
  variables?: Record<string, string>
  /** Les valeurs des boutons dynamiques du modèle. */
  buttons?: TemplateButtonValue[]
}

/** Un fichier déposé par `media.upload`, cité par son `mediaId`. `type` est son `kind`. */
export interface SendFile extends SendBase {
  type: MediaKind
  mediaId: string
  /** Sous le fichier, 1 024 caractères au plus. WhatsApp n'en montre aucune sous un son. */
  caption?: string
  /** `audio/ogg` seulement : une note vocale, avec sa forme d'onde. */
  voice?: boolean
}

/** Une réaction à un message de la conversation. */
export interface SendReaction extends Omit<SendBase, 'replyToId' | 'queue' | 'scheduledAt'> {
  type: 'reaction'
  /** Le message visé (identifiant Nodium). */
  messageId: string
  /** L'emoji ; `""` retire la dernière réaction posée. */
  emoji: string
}

export type SendContent = SendText | SendInteractive | SendLocation | SendContacts | SendTemplate | SendFile | SendReaction

export type SendInput = SendContent & SendAddress

export interface InteractiveForm {
  kind: 'buttons' | 'list' | 'location_request' | 'link' | 'flow'
  body?: string
  header?: string
  footer?: string
  buttons?: Array<{ id?: string, title: string }>
  /** `list` : le bouton qui l'ouvre ; `link` et `flow` : le bouton (20 caractères, obligatoire). */
  buttonLabel?: string
  /** `link` : l'adresse qu'ouvre le bouton, obligatoire. */
  url?: string
  sections?: Array<{ title?: string, rows: Array<{ id?: string, title: string, description?: string }> }>
  /** `flow` : l'identifiant chez Meta (`FlowSummary.metaFlowId`), obligatoire. */
  flowId?: string
  /** `flow` : votre jeton, rendu tel quel avec la réponse (`flowResponses.list({ flowToken })`). */
  flowToken?: string
  /** `flow` : l'écran de départ, s'il n'est pas le premier. */
  screen?: string
  /** `flow` : des valeurs passées à l'écran de départ. */
  data?: Record<string, unknown>
  /** `flow` dynamique : `data_exchange` l'ouvre par un appel `INIT` à votre point d'accès (ni `screen`, ni `data`). */
  action?: 'data_exchange'
  /** `flow` : `draft` pour essayer un formulaire non publié. */
  mode?: 'published' | 'draft'
}

// ── Conversations, contacts, canaux ────────────────────────────────────────

export interface Conversation {
  id: string
  channelId: string
  channelType: 'whatsapp'
  channelName: string
  contact: { id: string, displayName: string | null, identity: string, identityKind: 'phone' | 'email' | 'external', blocked: boolean }
  /** La fenêtre de service de 24 h de WhatsApp. */
  window: { applies: boolean, open: boolean, expiresAt: string | null, minutesLeft: number | null }
  lastInboundAt: string | null
  createdAt: string
  lastMessage: Record<string, unknown> | null
}

export interface ConversationQuery extends PageQuery {
  channelId?: string
  contactId?: string
  /** Le contact qui a ce numéro, écrit comme on veut (`+33 6 12 34 56 78`) ; 6 chiffres au moins. */
  phone?: string
}

export interface Contact {
  id: string
  displayName: string | null
  phone: string | null
  email: string | null
  externalId: string | null
  optInAt: string | null
  optOutAt: string | null
  blocked: boolean
  conversationCount: number
  createdAt: string
  updatedAt: string
}

export interface ContactInput {
  displayName?: string
  phone?: string
  email?: string
}

export interface ContactUpdate {
  displayName?: string
  optIn?: boolean
  blocked?: boolean
}

export interface Channel {
  id: string
  type: 'whatsapp'
  name: string
  identity: string
  isActive: boolean
  qualityRating: 'GREEN' | 'YELLOW' | 'RED' | null
  messagingLimit: string | null
  isTest: boolean
  /** Meta a refusé un message payant : le compte WhatsApp du client n'a pas de moyen de paiement (131042). */
  paymentMissing?: boolean
}

/** Le dernier contrôle de santé d'un numéro (`channels.check`). */
export interface ChannelHealth {
  checkedAt: string
  ok: boolean
  status: string | null
  verifiedName: string | null
  nameStatus: string | null
  throughputLevel: string | null
  message: string | null
}

/** Un canal en détail (`channels.get`). */
export interface ChannelDetail extends Channel {
  displayPhone: string | null
  /** Vrai : le numéro garde l'application WhatsApp Business du téléphone. */
  coexistence: boolean
  createdAt: string | null
  /** Le dernier message reçu sur ce numéro ; `null` : aucun encore. */
  lastInboundAt: string | null
  /** La page WhatsApp Manager du compte WhatsApp du numéro (moyen de paiement) ; `null` si inconnue. */
  managerUrl: string | null
  /** `null` tant qu'aucun contrôle n'a eu lieu. */
  health: ChannelHealth | null
}

/** Ce que voit la personne qui ouvre la fiche de l'entreprise dans WhatsApp. */
export interface BusinessProfile {
  /** La ligne « Info » (1 à 139 caractères). */
  about: string
  description: string
  address: string
  email: string
  /** Deux adresses au plus. */
  websites: string[]
  /** Un secteur de Meta (`HEALTH`, `RETAIL`…) ; vide = non renseigné. */
  vertical: string
  /** Lecture seule : Nodium ne dépose pas de photo. */
  pictureUrl: string | null
}

/** Chaque champ est facultatif : seuls ceux envoyés changent. */
export type BusinessProfilePatch = Partial<Omit<BusinessProfile, 'pictureUrl'>>

// ── Modèles ────────────────────────────────────────────────────────────────

export type TemplateCategory = 'UTILITY' | 'MARKETING' | 'AUTHENTICATION'

export type TemplateStatus =
  | 'draft' | 'not_deployed' | 'no_number'
  | 'submitted' | 'approved' | 'rejected' | 'paused' | 'disabled' | 'failed'

export interface Template {
  id: string
  name: string
  language: string
  category: TemplateCategory
  /** Son état chez Meta, dans les comptes WhatsApp de son client : seul `approved` peut partir. */
  status: TemplateStatus
  /** Le client à qui il appartient. */
  clientId: string
  deployedAt: string | null
  body: string
  createdAt: string
  updatedAt: string
}

export interface TemplateHoles {
  numbered: number[]
  named: string[]
}

export interface TemplateInput {
  name: string
  language: string
  category: TemplateCategory
  body: string
  header?: string
  footer?: string
  /** Les boutons : ceux de Meta (`QUICK_REPLY`, `URL`, `PHONE_NUMBER`, `COPY_CODE`), et un `TemplateFlowButton` au plus. */
  buttons?: Array<TemplateFlowButton | Record<string, unknown>>
}

export type TemplateUpdate = Partial<TemplateInput>

/** Où en est un modèle dans un compte WhatsApp de son client, à la suite d'un déploiement. */
export interface DeployOutcome {
  clientId: string
  clientName: string
  wabaId: string | null
  status: TemplateStatus
  reason: string | null
}

// ── Webhooks ───────────────────────────────────────────────────────────────

export interface WebhookSubscription {
  id: string
  url: string
  /** `*` = tous. */
  events: string[]
  /** Les numéros dont les événements sont remis ; vide = tous. */
  channelIds: string[]
  label: string
  isActive: boolean
  /** Pourquoi Nodium l'a mise en pause de lui-même, ou `null`. */
  disabledReason?: string | null
  lastDeliveredAt: string | null
  lastError: string | null
  previousSecretValidUntil: string | null
  createdAt: string
}

export interface WebhookInput {
  /** https:// seulement. */
  url: string
  events: string[]
  /** Ne recevoir que les événements de ces numéros. Vide ou absent : tous. */
  channelIds?: string[]
  label?: string
}

export interface WebhookUpdate {
  url?: string
  events?: string[]
  /** Liste vide = tous les numéros. */
  channelIds?: string[]
  label?: string
  isActive?: boolean
}

export interface WebhookDelivery {
  id: string
  subscriptionId: string
  event: string
  eventId: string
  status: 'pending' | 'delivered' | 'failed'
  attempts: number
  responseStatus: number | null
  lastError: string | null
  nextAttemptAt: string | null
  createdAt: string
  deliveredAt: string | null
}

export interface WebhookDeliveryQuery extends PageQuery {
  subscriptionId?: string
  status?: 'pending' | 'delivered' | 'failed'
  event?: string
}

// ── Diffusions ─────────────────────────────────────────────────────────────

export interface BroadcastInput {
  name: string
  whatsappTemplateId: string
  contactIds?: string[]
  /** Tous les contacts qui ont accepté de recevoir des messages. */
  allOptIn?: boolean
  channelId?: string
  variables?: Record<string, string>
  /** L'heure du départ, ISO 8601, au moins une minute d'avance ; absente = tout de suite. */
  scheduledAt?: string
  /** `true` : écrite sans partir ; les destinataires s'ajoutent ensuite, `launch` la lance. */
  draft?: boolean
}

export interface Broadcast {
  id: string
  name: string
  /**
   * `draft` : attend `launch` ; `scheduled` : part à `sendAt` ;
   * `paused` : des envois refusés d'affilée pour une raison de compte ; `resume` la reprend.
   */
  status: 'draft' | 'scheduled' | 'sending' | 'paused' | 'finished' | 'cancelled'
  templateId: string
  templateName: string
  channelId: string
  counts: Record<string, number>
  /** Quand la diffusion a été mise en pause, ou `null`. */
  pausedAt: string | null
  /** Le refus qui l'a mise en pause, ou `null`. */
  pauseReason: string | null
  /** Le refus de Meta expliqué (`code`, `title`, `action`, `actor`), ou `null`. */
  pauseInfo: { code: number, title: string, action: string, actor: 'you' | 'client' | 'nodium' | 'wait' } | null
  /** Le départ, ou `null` pour un brouillon. */
  sendAt: string | null
  sentAt: string | null
  createdAt: string
}

export interface BroadcastRecipient {
  id: string
  contactId: string
  phone: string | null
  status: 'pending' | 'sending' | 'sent' | 'failed' | 'cancelled'
  error: string | null
  errorCode: string | null
  messageId: string | null
  attemptedAt: string | null
  createdAt: string
}

/** Le nom d'affichage d'un numéro : celui qui sert, et celui que Meta revoit. */
export interface DisplayName {
  verifiedName: string | null
  nameStatus: string | null
  requestedName: string | null
  requestedStatus: string | null
}

/** Le nom d'utilisateur WhatsApp d'un numéro (`@nom`). */
export interface Username {
  username: string | null
  /** `approved` : visible ; `reserved` : gardé pour le numéro, pas encore visible. */
  status: 'approved' | 'reserved' | null
}

export interface BroadcastPreview {
  matched: number
  recipients: number
  withoutConsent: number
  withoutNumber: number
}

// ── Compte : offre ──────────────────────────────────────────────────────────

export interface BillingSummary {
  plan: Record<string, unknown>
  activeClients: number
  allowance: number
  used: number
  overageUnits: number
  blocking: boolean
  basePriceCents: number
  clientPriceCents: number
  overagePriceCents: number
  eventsPerOverageUnit: number
  estimatedTotalCents: number
  currency: string
  periodEnd: string
}

export interface Health {
  healthy: boolean
  /** Ce qui ne va pas, le plus grave d'abord. */
  alerts: Array<{ level: 'warning' | 'critical', code: 'channel_silent' | 'channel_without_credentials' | 'channel_quality_red', channelId: string, message: string }>
}

// ── Formulaires WhatsApp (Flows) ───────────────────────────────────────────

export type FlowStatus = 'draft' | 'published' | 'deprecated' | 'blocked' | 'throttled'

export type FlowCategory =
  | 'SIGN_UP' | 'SIGN_IN' | 'APPOINTMENT_BOOKING' | 'LEAD_GENERATION'
  | 'CONTACT_US' | 'CUSTOMER_SUPPORT' | 'SURVEY' | 'OTHER'

export interface Flow {
  id: string
  /** L'identifiant chez Meta : le `flowId` d'un envoi. */
  metaFlowId: string
  wabaId: string
  name: string
  status: FlowStatus
  /** `dynamic` dès qu'un point d'accès est attaché. */
  mode: 'static' | 'dynamic'
  categories: FlowCategory[]
  createdAt: string
  updatedAt: string
}

export interface FlowValidationError {
  error: string
  error_type: string
  message: string
  line_start?: number
  line_end?: number
  column_start?: number
  column_end?: number
}

export interface FlowVersion {
  id: string
  /** `v1`, `v2`… */
  label: string
  flowJson: Record<string, unknown>
  sha: string
  validationErrors: FlowValidationError[]
  /** Posé sur la version que Meta a publiée. */
  publishedAt: string | null
  createdAt: string
}

export interface FlowInput {
  name: string
  /** Défaut : `OTHER`. */
  categories?: FlowCategory[]
  /** Si le client a plusieurs comptes WhatsApp Business. */
  wabaId?: string
  /** Défaut : un petit questionnaire de satisfaction. */
  flowJson?: Record<string, unknown>
}

export interface FlowQuery {
  status?: FlowStatus
  mode?: 'static' | 'dynamic'
  /** Cherche dans le nom. */
  q?: string
}

/** Où Nodium relaie les appels de Meta à un Flow dynamique. */
export interface FlowDataEndpoint {
  /** L'adresse https du développeur. */
  url: string
  /** L'adresse que Meta appelle, chez Nodium. */
  metaUrl: string
}

export interface FlowInvocation {
  id: string
  action: string
  screen: string | null
  statusCode: number | null
  durationMs: number | null
  error: string | null
  createdAt: string
}

export interface FlowResponse {
  messageId: string
  conversationId: string
  contact: { id: string | null, name: string | null, identity: string | null }
  /** Le `flowToken` posé à l'envoi, s'il y en avait un. */
  flowToken: string | null
  /** Ce que le contact a saisi, champ par champ. */
  data: Record<string, unknown>
  createdAt: string
}

export interface FlowResponseQuery extends PageQuery {
  flowToken?: string
  /** ISO 8601. */
  from?: string
  /** ISO 8601, exclue. */
  to?: string
}

// ── Médias, statistiques, liens, recherche ─────────────────────────────────

export type MediaKind = 'image' | 'video' | 'audio' | 'document'

export interface MediaItem {
  /** Le message qui porte le fichier : c'est lui qui le désigne. */
  messageId: string
  conversationId: string
  direction: 'inbound' | 'outbound'
  kind: MediaKind
  mimeType: string | null
  filename: string | null
  createdAt: string
}

/** Un fichier déposé par `media.upload`, prêt à être cité par `messages.send`. */
export interface MediaUpload {
  /** À passer en `mediaId` de `messages.send`. */
  mediaId: string
  /** Le `type` avec lequel l'envoyer. */
  kind: MediaKind
  mimeType: string
  filename: string | null
  /** Sa taille, en octets. */
  size: number
  /** ISO 8601 : jusque-là le `mediaId` peut partir (7 jours). */
  expiresAt: string
}

export interface MediaUploadOptions {
  /** Le nom du fichier ; à défaut, celui du `File`, sinon `file`. */
  filename?: string
  /** Son type (`image/png`…) ; à défaut, celui du `Blob`. */
  contentType?: string
}

export interface MediaQuery extends PageQuery {
  kind?: MediaKind
  from?: string
  to?: string
}

export interface DeliveryTotals {
  sent: number
  /** Livrés ou lus. */
  delivered: number
  read: number
  /** Une réponse du contact dans les 24 h suivant l'envoi. */
  replied: number
  failed: number
  /** Écartés avant l'envoi (sans accord, sans numéro) : diffusions seulement. */
  skipped: number
}

export interface DeliveryStats {
  from: string
  to: string
  source: 'template' | 'broadcast'
  totals: DeliveryTotals
  /** La période de même durée qui précède. */
  previous: DeliveryTotals
  /** Par jour (UTC). */
  days: Array<{ day: string, sent: number, delivered: number }>
  /** Par modèle ou par diffusion (50 au plus). */
  groups: Array<{ key: string, label: string, sent: number, delivered: number, read: number, replied: number, failed: number }>
}

export interface DeliveryStatsQuery {
  /** ISO 8601. Défaut : `to` moins 30 jours (366 au plus). */
  from?: string
  /** ISO 8601, exclue. Défaut : maintenant. */
  to?: string
  /** `template` (défaut) ou `broadcast`. */
  source?: 'template' | 'broadcast'
  channelId?: string
}

export interface ConnectLinkItem {
  id: string
  client: { id: string, name: string, externalId: string | null, isHome: boolean }
  /** `expired` : périmé ou révoqué. */
  state: 'pending' | 'used' | 'expired'
  expiresAt: string
  createdAt: string
  usedAt: string | null
  redirectUrl: string | null
  /** Le canal branché par ce lien, une fois utilisé. */
  channelId: string | null
  /** La première ouverture par votre client, ou `null`. */
  openedAt: string | null
  /** La dernière issue d'une tentative par ce lien, ou `null` avant la première. */
  lastAttempt: { at: string, status: 'completed' | 'failed' | 'abandoned', code: string | null, step: string | null } | null
}

export interface ConnectLinkQuery extends PageQuery {
  state?: 'pending' | 'used' | 'expired'
  /** Un client : son id, ou votre `externalId`. */
  client?: string
}

/** Filtres de l'export CSV des contacts (ceux de `contacts.list`). */
export interface ContactExportQuery {
  q?: string
  consent?: 'in' | 'out' | 'unknown'
  blocked?: boolean
  channel?: string
}

/** `connectLinks.update` : au moins l'un des deux. */
export interface ConnectLinkUpdate {
  /** 1 à 30 jours, à partir de maintenant. */
  expiresInDays?: number
  /** https:// seulement ; `null` efface le retour. */
  redirectUrl?: string | null
}

export interface ConnectLinkUpdated {
  id: string
  expiresAt: string
  redirectUrl: string | null
  mode: 'dedicated' | 'coexistence' | null
  phoneNumber: string | null
}

/** Un contrôle du diagnostic d'un numéro (`channels.diagnostic`). */
export interface NumberDiagnosticCheck {
  check: 'client' | 'connection' | 'number' | 'health' | 'account' | 'payment' | 'reception' | 'inbound'
  ok: boolean
  status: 'ok' | 'warn' | 'fail' | 'skip'
  /** Un code stable (`number_quality_red`…) : c'est lui qu'on teste, pas la phrase. */
  code: string
  message: string
  action: string | null
  /** Qui peut régler : vous, Nodium, Meta (en revue), ou personne. */
  actor: 'you' | 'nodium' | 'meta' | 'none'
}

export interface NumberDiagnostic {
  at: string
  verdict: 'ok' | 'warn' | 'fail'
  checks: NumberDiagnosticCheck[]
}

/** Un appel fait avec une clé du compte (`apiRequests.list`). */
export interface ApiRequest {
  id: string
  apiKeyId: string
  keyLabel: string
  keyPrefix: string
  clientId: string | null
  method: string
  path: string
  status: number
  errorCode: string | null
  durationMs: number
  requestId: string | null
  createdAt: string
}

export interface ApiRequestQuery extends PageQuery {
  apiKeyId?: string
  clientId?: string
  /** Seulement les appels qui n'ont pas réussi (400 et plus). */
  errorsOnly?: boolean
}

/** Le bac à sable du compte (`sandbox.get`). Fermé : `available: false`, le reste vide. */
export interface SandboxState {
  available: boolean
  displayPhone: string | null
  joinCode: string | null
  /** Le message à envoyer depuis votre téléphone pour le relier. */
  joinMessage: string | null
  waLink: string | null
  /** Le canal du bac à sable, une fois un téléphone relié : c'est de lui qu'on envoie. */
  channelId: string | null
  linkedPhones: Array<Record<string, unknown>>
  limits: { dailyMessages: number, sentToday: number, maxPhones: number } | null
}
