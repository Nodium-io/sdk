/**
 * Le refus d'un appel : la forme `{ error }` de l'API (`shared/apiErrors.json`),
 * ou une panne de réseau (`status` = 0, `code` = `network_error` / `timeout`).
 *
 * `code` est stable : on branche sa logique dessus, jamais sur `message`.
 */
/**
 * Que faire d'un refus :
 * · `retry`         — réessayer tel quel (le SDK l'a déjà fait `maxRetries` fois) ;
 * · `retry_after`   — réessayer après `retryAfterMs` ;
 * · `fix_and_retry` — corriger l'appel (un champ, un modèle, la fenêtre de 24 h), puis réessayer ;
 * · `upgrade`       — une limite d'offre ou de quota : la solution est commerciale ;
 * · `do_not_retry`  — le même appel échouera toujours (clé refusée, ressource absente).
 */
export type RetryAction = 'retry' | 'retry_after' | 'fix_and_retry' | 'upgrade' | 'do_not_retry'

export interface RetryHint {
  action: RetryAction
  /** Avec `retry_after` : l'attente, en millisecondes. */
  retryAfterMs?: number
}

export interface NodiumErrorBody {
  status: number
  code: string
  message: string
  detail?: string | null
  requestId?: string | null
  /** Ce que la route ajoute au refus (`data.key` de `plan_limit`, `tenantId` de `tenant_exists`…). */
  data?: Record<string, unknown>
}

export class NodiumError extends Error {
  readonly status: number
  readonly code: string
  /** Le texte de la route, quand elle en donne un (plus précis que `message`). */
  readonly detail: string | null
  /** À donner au support : il retrouve l'appel dans le journal. */
  readonly requestId: string | null
  /** Secondes à attendre avant de réessayer (`Retry-After`), `null` sans indication. */
  readonly retryAfter: number | null
  readonly data: Record<string, unknown>

  constructor(body: NodiumErrorBody, retryAfter: number | null = null) {
    super(body.detail ? `${body.message} ${body.detail}` : body.message)
    this.name = 'NodiumError'
    this.status = body.status
    this.code = body.code
    this.detail = body.detail ?? null
    this.requestId = body.requestId ?? null
    this.retryAfter = retryAfter
    this.data = body.data ?? {}
  }

  /** Vrai pour une limite d'offre ou de quota : la solution est commerciale, pas technique. */
  get isPlanLimit(): boolean {
    return this.code === 'plan_limit' || this.code === 'quota_exceeded'
  }

  /** La clé est absente, refusée ou expirée, ou l'appel lui est interdit (401, 403). */
  isAuthError(): boolean {
    return this.status === 401 || this.status === 403
  }

  /** Trop d'appels : 429, `retryAfter` dit combien attendre. */
  isRateLimit(): boolean {
    return this.status === 429
  }

  /** La ressource n'existe pas, ou pas pour cette clé (un autre client rend 404, jamais 403). */
  isNotFound(): boolean {
    return this.status === 404
  }

  /** Une panne de réseau ou un délai dépassé : l'appel n'a peut-être jamais atteint Nodium. */
  isNetworkError(): boolean {
    return this.status === 0
  }

  /** Que faire de ce refus (voir `RetryAction`). */
  get retry(): RetryHint {
    if (this.isPlanLimit) return { action: 'upgrade' }
    if (this.status === 429 || this.status === 503) {
      return this.retryAfter !== null ? { action: 'retry_after', retryAfterMs: this.retryAfter * 1000 } : { action: 'retry' }
    }
    if (this.status === 0 || this.status >= 500) return { action: 'retry' }
    if (this.status === 401 || this.status === 403 || this.status === 404 || this.status === 410) return { action: 'do_not_retry' }
    return { action: 'fix_and_retry' }
  }

  toJSON(): NodiumErrorBody & { retryAfter: number | null } {
    return {
      status: this.status, code: this.code, message: this.message, detail: this.detail,
      requestId: this.requestId, data: this.data, retryAfter: this.retryAfter
    }
  }
}

/** Le refus d'une signature de webhook (`verifyWebhook`, `@nodium.io/whatsapp/server`). */
export class NodiumSignatureError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NodiumSignatureError'
  }
}
