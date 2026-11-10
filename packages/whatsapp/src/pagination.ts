import type { Page } from './types'

/**
 * Parcourir toutes les pages d'une liste : `for await (const t of each(fetchPage))`.
 * `fetchPage` reçoit le curseur (absent à la première page) et rend une page.
 */
export async function* each<T>(fetchPage: (cursor?: string) => Promise<Page<T>>): AsyncGenerator<T, void, void> {
  let cursor: string | undefined
  for (;;) {
    const page = await fetchPage(cursor)
    yield* page.items
    if (!page.nextCursor || !page.items.length) return
    cursor = page.nextCursor
  }
}
