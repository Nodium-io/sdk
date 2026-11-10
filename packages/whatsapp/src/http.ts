import { NodiumError } from './errors'

/**
 * Le transport : une clé, un `fetch`, des nouvelles tentatives prudentes.
 *
 * ⚠️ On ne réessaie une ÉCRITURE que si elle porte une clé anti-doublon
 *    (`idempotent`) : sinon un 502 après coup enverrait deux messages. Les
 *    lectures et les suppressions se réessaient toujours.
 * ⚠️ 429 : on attend `Retry-After` (secondes) s'il est donné ; sinon, un
 *    recul exponentiel borné, avec un peu de hasard.
 */
export interface NodiumOptions {
  /** Défaut : `https://nodium.io/api/v1`. */
  baseUrl?: string
  /** Un `fetch` à soi (tests, proxy). Défaut : le `fetch` global. */
  fetch?: typeof fetch
  /** Délai d'un appel, en millisecondes. Défaut : 30 000. */
  timeoutMs?: number
  /** Nouvelles tentatives après le premier essai. Défaut : 2. */
  maxRetries?: number
  /** L'attente entre deux essais (tests). Défaut : `setTimeout`. */
  sleep?: (ms: number) => Promise<void>
}

export interface RequestInput {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  path: string
  query?: object
  body?: unknown
  /**
   * Un corps `multipart/form-data` (le dépôt d'un fichier) à la place du JSON.
   * ⚠️ Aucun `Content-Type` n'est posé : `fetch` y met la frontière du
   * formulaire.
   */
  form?: FormData
  /** Le client visé : posé dans `Nodium-Tenant`. */
  tenant?: string | null
  /** Vrai si rejouer l'appel ne peut pas le faire deux fois (clé anti-doublon posée). */
  idempotent?: boolean
  headers?: Record<string, string>
  signal?: AbortSignal
}

export const DEFAULT_BASE_URL = 'https://nodium.io/api/v1'
const RETRYABLE = new Set([429, 500, 502, 503, 504])
const BACKOFF_MS = 500
const BACKOFF_CAP_MS = 20_000

/** Les paramètres d'adresse, sans les valeurs vides. */
export function queryString(query?: object): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null || value === '') continue
    params.set(key, Array.isArray(value) ? value.join(',') : String(value))
  }
  const text = params.toString()
  return text ? `?${text}` : ''
}

/** `Retry-After` en secondes (un nombre, ou une date HTTP), `null` si illisible. */
export function parseRetryAfter(value: string | null, now = Date.now()): number | null {
  if (!value) return null
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) return seconds
  const at = Date.parse(value)
  return Number.isNaN(at) ? null : Math.max(0, Math.ceil((at - now) / 1000))
}

export class Http {
  readonly baseUrl: string
  private readonly key: string
  private readonly fetchImpl: typeof fetch
  private readonly timeoutMs: number
  private readonly maxRetries: number
  private readonly sleep: (ms: number) => Promise<void>

  constructor(key: string, options: NodiumOptions = {}) {
    if (!key || typeof key !== 'string') throw new TypeError('Nodium: an API key is required (nod_…).')
    this.key = key
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '')
    const f = options.fetch ?? globalThis.fetch
    if (!f) throw new TypeError('Nodium: no fetch available — pass `fetch` in the options.')
    this.fetchImpl = f
    this.timeoutMs = options.timeoutMs ?? 30_000
    this.maxRetries = Math.max(0, options.maxRetries ?? 2)
    this.sleep = options.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)))
  }

  private headers(input: Pick<RequestInput, 'tenant' | 'headers' | 'body'>): Record<string, string> {
    return {
      Authorization: `Bearer ${this.key}`,
      Accept: 'application/json',
      ...(input.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(input.tenant ? { 'Nodium-Tenant': input.tenant } : {}),
      ...input.headers
    }
  }

  private url(path: string, query?: object) {
    return `${this.baseUrl}${path}${queryString(query)}`
  }

  /** L'attente avant l'essai suivant, en millisecondes. */
  private delay(attempt: number, retryAfter: number | null): number {
    if (retryAfter !== null) return Math.min(retryAfter * 1000, 60_000)
    const base = Math.min(BACKOFF_CAP_MS, BACKOFF_MS * 2 ** attempt)
    return base / 2 + Math.random() * (base / 2)
  }

  /** Un appel JSON ; rend le contenu de `data`. */
  async request<T>(input: RequestInput): Promise<T> {
    const safe = input.method === 'GET' || input.method === 'DELETE' || input.idempotent === true
    const url = this.url(input.path, input.query)
    const init = {
      method: input.method,
      headers: this.headers(input),
      ...(input.form ? { body: input.form } : input.body !== undefined ? { body: JSON.stringify(input.body) } : {})
    }

    for (let attempt = 0; ; attempt++) {
      const last = attempt >= this.maxRetries || !safe
      let response: Response
      try {
        response = await this.fetchImpl(url, { ...init, signal: this.signal(input.signal) })
      } catch (cause: any) {
        if (input.signal?.aborted) throw cause
        if (!last) { await this.sleep(this.delay(attempt, null)); continue }
        const timedOut = cause?.name === 'TimeoutError' || cause?.name === 'AbortError'
        throw new NodiumError({
          status: 0,
          code: timedOut ? 'timeout' : 'network_error',
          message: timedOut ? 'The request timed out.' : 'The request could not reach Nodium.',
          detail: cause?.message ?? null
        })
      }

      if (response.ok) return await this.readData<T>(response)

      const retryAfter = parseRetryAfter(response.headers.get('retry-after'))
      if (RETRYABLE.has(response.status) && !last) {
        await this.sleep(this.delay(attempt, retryAfter))
        continue
      }
      throw await this.readError(response, retryAfter)
    }
  }

  /** Le flux brut d'une route qui n'est pas du JSON (un média). */
  async raw(input: Omit<RequestInput, 'body' | 'method'> & { accept?: string }): Promise<Response> {
    const response = await this.fetchImpl(this.url(input.path, input.query), {
      method: 'GET',
      headers: { ...this.headers(input), Accept: input.accept ?? '*/*' },
      ...(input.signal ? { signal: input.signal } : {})
    })
    if (!response.ok) throw await this.readError(response, parseRetryAfter(response.headers.get('retry-after')))
    return response
  }

  private signal(user?: AbortSignal): AbortSignal {
    const timeout = AbortSignal.timeout(this.timeoutMs)
    return user && 'any' in AbortSignal ? (AbortSignal as any).any([user, timeout]) : (user ?? timeout)
  }

  private async readData<T>(response: Response): Promise<T> {
    if (response.status === 204) return undefined as T
    const text = await response.text()
    if (!text) return undefined as T
    const json = JSON.parse(text)
    return (json && typeof json === 'object' && 'data' in json ? json.data : json) as T
  }

  private async readError(response: Response, retryAfter: number | null): Promise<NodiumError> {
    let body: any = null
    try { body = JSON.parse(await response.text()) } catch { /* corps non JSON : on retombe sur le statut */ }
    const e = body?.error
    return new NodiumError({
      status: Number(e?.status ?? response.status),
      code: String(e?.code ?? 'unknown_error'),
      message: String(e?.message ?? `Request failed with status ${response.status}.`),
      detail: e?.detail ?? null,
      requestId: e?.requestId ?? response.headers.get('x-request-id'),
      ...(e?.data && typeof e.data === 'object' ? { data: e.data } : {})
    }, retryAfter)
  }
}
