import type { ConnectLinkInput, ConnectLinkPrefill, TenantBusiness, TenantUpdate } from '@nodium.io/whatsapp'
import { UsageError, flag, hasFlag, readInteger } from '../args'
import { listLimit, pageSize, take, type Command, type Ctx } from '../context'
import { details, paint, table } from '../output'

/**
 * Vos clients (un par client final, « Mon entreprise » compris) et le lien
 * hébergé où chacun branche son WhatsApp.
 *
 * ⚠️ L'adresse d'un lien ne se montre qu'à sa création : la commande l'écrit
 *    une fois, rien ne la relit.
 */

/**
 * Ce que la fiche « Votre entreprise » de la page reçoit d'avance : chaque
 * drapeau donné remplit son champ. `--business-name`, pas `--name`, qui
 * nomme déjà le client dans `tenants new`.
 */
function prefillInput(ctx: Ctx): ConnectLinkPrefill | null {
  const text = (name: string) => flag(ctx.args, name)?.trim() || undefined
  const address = { street: text('street'), city: text('city'), postalCode: text('postal-code') }
  const prefill: ConnectLinkPrefill = {
    name: text('business-name'),
    displayName: text('display-name'),
    website: text('website'),
    email: text('email'),
    country: text('country')?.toUpperCase(),
    category: text('category')?.toUpperCase(),
    description: text('description'),
    ...(Object.values(address).some(Boolean) ? { address } : {})
  }
  const given = Object.fromEntries(Object.entries(prefill).filter(([, value]) => value !== undefined)) as ConnectLinkPrefill
  return Object.keys(given).length ? given : null
}

/** `--redirect-url`, `--expires-in-days`, `--mode`, `--phone` et la fiche de l'entreprise, s'ils sont donnés. */
function linkInput(ctx: Ctx): ConnectLinkInput {
  const redirectUrl = flag(ctx.args, 'redirect-url')
  const expiresInDays = readInteger(ctx.args, 'expires-in-days', 1)
  if (expiresInDays !== null && expiresInDays > 30) throw new UsageError('--expires-in-days must be 30 or less.')
  const rawMode = flag(ctx.args, 'mode')
  const mode = rawMode === 'dedicated' || rawMode === 'coexistence' ? rawMode : null
  if (rawMode && !mode) throw new UsageError('--mode is dedicated or coexistence.')
  const phoneNumber = flag(ctx.args, 'phone')
  const prefill = prefillInput(ctx)
  return {
    ...(redirectUrl ? { redirectUrl } : {}),
    ...(expiresInDays !== null ? { expiresInDays } : {}),
    ...(mode ? { mode } : {}),
    ...(phoneNumber ? { phoneNumber } : {}),
    ...(prefill ? { prefill } : {})
  }
}

function printLink(ctx: Ctx, url: string, expiresAt: string): void {
  ctx.output.out(`Send this link to your client (single use, until ${expiresAt.slice(0, 10)}):`)
  ctx.output.out(paint(ctx.output, 'bold', url))
  ctx.output.err(paint(ctx.output, 'dim', 'It is shown only now. A lost link is replaced by a new one.'))
}

async function list(ctx: Ctx): Promise<number> {
  const limit = listLimit(ctx.args)
  const externalId = flag(ctx.args, 'external-id')
  const items = await take(ctx.nodium().tenants.each({ limit: pageSize(limit), ...(externalId ? { externalId } : {}) }), limit)
  ctx.print(items, () => {
    for (const line of table(items.map(t => [t.id, t.externalId ?? '—', t.name, `WhatsApp ${t.whatsapp.status.replace('_', ' ')}`, t.status]))) ctx.output.out(line)
  }, items.length ? [`nodium tenants get ${items[0]!.externalId ?? items[0]!.id}`] : ['nodium tenants new --name "<client name>" --connect-link'])
  return 0
}

async function get(ctx: Ctx): Promise<number> {
  const tenant = await ctx.nodium().tenants.get(ctx.args.positionals[0]!)
  ctx.print(tenant, () => details(tenant).forEach(line => ctx.output.out(line)), tenant.whatsapp.status === 'connected'
    ? [`nodium numbers list --tenant ${tenant.externalId ?? tenant.id}`]
    : [`nodium connect-link new --tenant ${tenant.externalId ?? tenant.id}`])
  return 0
}

async function create(ctx: Ctx): Promise<number> {
  const name = flag(ctx.args, 'name')
  if (!name) throw new UsageError('--name "<client name>" is required.')
  const externalId = flag(ctx.args, 'external-id')
  const withLink = hasFlag(ctx.args, 'connect-link')
  await ctx.confirm(`Add the client "${name}"${withLink ? ' and create its connect link' : ''}`)
  const input = { name, ...(externalId ? { externalId } : {}) }
  const tenants = ctx.nodium().tenants
  if (withLink) {
    const tenant = await tenants.create(input, { connectLink: linkInput(ctx) })
    ctx.print(tenant, () => {
      ctx.output.out(`${paint(ctx.output, 'green', 'Client added')}: ${tenant.name} (${tenant.id}).`)
      printLink(ctx, tenant.connectLink.url, tenant.connectLink.expiresAt)
    }, [`nodium tenants get ${tenant.externalId ?? tenant.id}`])
    return 0
  }
  const tenant = await tenants.create(input)
  ctx.print(tenant, () => {
    ctx.output.out(`${paint(ctx.output, 'green', 'Client added')}: ${tenant.name} (${tenant.id}).`)
  }, [`nodium connect-link new --tenant ${tenant.externalId ?? tenant.id}`])
  return 0
}

/** `tenants update` : le nom, l'identifiant, et la fiche de l'entreprise par les mêmes drapeaux que le lien. */
async function update(ctx: Ctx): Promise<number> {
  const id = ctx.args.positionals[0]!
  const name = flag(ctx.args, 'name')
  const externalId = flag(ctx.args, 'external-id')
  const prefill = prefillInput(ctx)
  const business: Partial<TenantBusiness> | null = prefill
    ? Object.fromEntries(Object.entries({
        name: prefill.name, displayName: prefill.displayName, email: prefill.email, website: prefill.website,
        street: prefill.address?.street, postalCode: prefill.address?.postalCode, city: prefill.address?.city,
        country: prefill.country, category: prefill.category, description: prefill.description
      }).filter(([, value]) => value !== undefined))
    : null
  const input: TenantUpdate = {
    ...(name ? { name } : {}),
    ...(externalId !== undefined ? { externalId } : {}),
    ...(business ? { business } : {})
  }
  if (!Object.keys(input).length) throw new UsageError('Nothing to change: --name, --external-id, or a business flag (--business-name, --website…).')
  await ctx.confirm(`Update client ${id}`)
  const tenant = await ctx.nodium().tenants.update(id, input)
  ctx.print(tenant, () => {
    ctx.output.out(`${paint(ctx.output, 'green', 'Client updated')}: ${tenant.name} (${tenant.id}).`)
    ctx.output.out(tenant.business.complete
      ? 'Its business form is complete: Meta\'s window opens right after the question on the connect page.'
      : 'Its business form is not complete yet: your client finishes it on the connect page.')
  }, [`nodium tenants get ${tenant.externalId ?? tenant.id}`])
  return 0
}

/** Les liens du compte, le plus récent d'abord : où en est chaque client. */
async function links(ctx: Ctx): Promise<number> {
  const limit = listLimit(ctx.args)
  const rawState = flag(ctx.args, 'state')
  const state = rawState === 'pending' || rawState === 'used' || rawState === 'expired' ? rawState : undefined
  if (rawState && !state) throw new UsageError('--state is pending, used or expired.')
  const client = flag(ctx.args, 'client')
  const items = await take(ctx.nodium().connectLinks.each({ limit: pageSize(limit), ...(state ? { state } : {}), ...(client ? { client } : {}) }), limit)
  ctx.print(items, () => {
    if (!items.length) ctx.output.out('No connect link.')
    for (const line of table(items.map(link => [
      link.id,
      link.client.externalId ?? link.client.name,
      link.state,
      link.state === 'pending' ? `until ${link.expiresAt.slice(0, 10)}` : '',
      link.lastAttempt
        ? `last try: ${link.lastAttempt.status}${link.lastAttempt.code ? ` (${link.lastAttempt.code}${link.lastAttempt.step ? ` at ${link.lastAttempt.step}` : ''})` : ''}`
        : link.openedAt ? 'opened, not tried' : 'not opened'
    ]))) ctx.output.out(line)
  }, items.some(link => link.state === 'pending')
    ? [`nodium connect-link update ${items.find(link => link.state === 'pending')!.id} --expires-in-days 7`]
    : ['nodium connect-link new --tenant <id>'])
  return 0
}

async function revokeLink(ctx: Ctx): Promise<number> {
  const id = ctx.args.positionals[0]!
  await ctx.confirm(`Revoke connect link ${id}: it stops working at once`)
  const result = await ctx.nodium().connectLinks.revoke(id)
  ctx.print(result, () => ctx.output.out(`${paint(ctx.output, 'green', 'Revoked')}: the link no longer works.`), ['nodium connect-link list --state pending'])
  return 0
}

/** Prolonger un lien en attente, ou changer son retour : l'adresse envoyée reste bonne. */
async function updateLink(ctx: Ctx): Promise<number> {
  const id = ctx.args.positionals[0]!
  const expiresInDays = readInteger(ctx.args, 'expires-in-days', 1)
  if (expiresInDays !== null && expiresInDays > 30) throw new UsageError('--expires-in-days must be 30 or less.')
  const redirectUrl = flag(ctx.args, 'redirect-url')
  if (expiresInDays === null && redirectUrl === undefined) throw new UsageError('Nothing to change: --expires-in-days or --redirect-url.')
  await ctx.confirm(`Update connect link ${id}`)
  const link = await ctx.nodium().connectLinks.update(id, {
    ...(expiresInDays !== null ? { expiresInDays } : {}),
    ...(redirectUrl !== undefined ? { redirectUrl: redirectUrl || null } : {})
  })
  ctx.print(link, () => ctx.output.out(`${paint(ctx.output, 'green', 'Updated')}: it works until ${link.expiresAt.slice(0, 10)}. The address you sent stays the same.`), ['nodium connect-link list --state pending'])
  return 0
}

async function newLink(ctx: Ctx): Promise<number> {
  const tenant = flag(ctx.args, 'tenant')
  if (!tenant) throw new UsageError('--tenant <id> is required: the client who connects (its id or your externalId).')
  const input = linkInput(ctx)
  await ctx.confirm(`Create a connect link for client ${tenant}`)
  const link = await ctx.nodium().tenants.connectLink(tenant, input)
  ctx.print(link, () => printLink(ctx, link.url, link.expiresAt), [`nodium tenants get ${tenant}`])
  return 0
}

const BUSINESS_FLAGS = ['business-name', 'display-name', 'email', 'website', 'street', 'postal-code', 'city', 'country', 'category', 'description']
const LINK_FLAGS = ['redirect-url', 'expires-in-days', 'mode', 'phone', ...BUSINESS_FLAGS]

const BUSINESS_HELP = `  --business-name <text>       The business name. Default: the client's name.
  --display-name <text>        The name shown in WhatsApp. Default: the business name.
  --email <address>            The business email.
  --website <domain>           Its website, or Facebook or Instagram page.
  --street <text>              Street and number.
  --postal-code <code>         Postal code.
  --city <text>                City.
  --country <FR>               ISO country code.
  --category <RETAIL>          Industry, as in the WhatsApp profile (RESTAURANT, RETAIL, HEALTH…).
  --description <text>         One sentence on what the business does.`

const LINK_HELP = `  --redirect-url <https://…>   Where your client lands once connected.
  --expires-in-days <n>        1 to 30, default 7.
  --mode <mode>                dedicated or coexistence: your client is not asked.
  --phone <+33…>               The only number the link connects.

  Prefilled in the "Your business" form, for your client to check (Meta's window is filled from it):
${BUSINESS_HELP}`

export const TENANT_COMMANDS: Command[] = [
  {
    path: ['tenants', 'list'], summary: 'Your clients, newest first.', flags: ['limit', 'external-id'],
    help: `  --external-id <id>   The client with your own identifier.
  --limit <n>          At most n (default 20).`,
    run: list
  },
  { path: ['tenants', 'get'], args: ['<id>'], summary: 'One client, by its id or your externalId.', run: get },
  {
    path: ['tenants', 'new'], summary: 'Add a client. With --connect-link, prints the link to send it.',
    flags: ['name', 'external-id', 'connect-link', ...LINK_FLAGS],
    help: `  --name <text>          The client's name. Required.
  --external-id <id>     Your own identifier for it: unique, it makes the call safe to repeat.
  --connect-link         Also create the link where it connects its WhatsApp.
${LINK_HELP}`,
    run: create
  },
  {
    path: ['tenants', 'update'], args: ['<id>'], summary: 'Rename a client, or fill its business form. Asks first.',
    flags: ['name', 'external-id', ...BUSINESS_FLAGS],
    help: `  --name <text>          New name.
  --external-id <id>     New identifier of yours.

  Its "Your business" form, kept for every link and number (each flag replaces its own field):
${BUSINESS_HELP}`,
    run: update
  },
  {
    path: ['connect-link', 'list'], summary: 'Your connect links, newest first, and where each client stands.', flags: ['state', 'client', 'limit'],
    help: `  --state <state>   pending, used or expired.
  --client <id>     One client: its id or your externalId.
  --limit <n>       At most n (default 20).`,
    run: links
  },
  { path: ['connect-link', 'revoke'], args: ['<id>'], summary: 'Make a pending link stop working. Asks first.', run: revokeLink },
  {
    path: ['connect-link', 'update'], args: ['<id>'], summary: 'Extend a pending link, or change where it sends back. Asks first.',
    flags: ['expires-in-days', 'redirect-url'],
    help: `  --expires-in-days <n>        New lifetime from now, 1 to 30.
  --redirect-url <https://…>   Where your client lands; an empty value removes it.`,
    run: updateLink
  },
  {
    path: ['connect-link', 'new'], summary: 'A link where your client connects its WhatsApp number.',
    flags: LINK_FLAGS,
    help: `  --tenant <id>                The client. Required.
${LINK_HELP}`,
    run: newLink
  }
]
