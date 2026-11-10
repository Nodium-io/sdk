# @nodium.io/whatsapp

[![npm version](https://img.shields.io/npm/v/@nodium.io/whatsapp.svg)](https://www.npmjs.com/package/@nodium.io/whatsapp)
[![npm downloads](https://img.shields.io/npm/dm/@nodium.io/whatsapp.svg)](https://www.npmjs.com/package/@nodium.io/whatsapp)
[![license](https://img.shields.io/npm/l/@nodium.io/whatsapp.svg)](./LICENSE)

TypeScript client for the [Nodium](https://nodium.io) WhatsApp API: send and
receive WhatsApp messages, templates, Flows and broadcasts from your code — for
your own number or your clients' numbers, behind one key.

- No runtime dependency: the native `fetch` (Node 20+, Bun, Deno, browsers).
- ESM and CommonJS, types included.
- Webhook verification and dynamic Flow calls live in `@nodium.io/whatsapp/server` (it needs `node:crypto`).

## Install

```bash
npm install @nodium.io/whatsapp
```

## Quick start

```ts
import { Nodium } from '@nodium.io/whatsapp'

const nodium = new Nodium(process.env.NODIUM_KEY!) // nod_… — Settings › API keys in the console

const [channel] = await nodium.channels.list() // your connected WhatsApp numbers

await nodium.messages.send({
  channelId: channel.id,
  to: '+33612345678',
  type: 'template', // a first message is always an approved template
  templateName: 'order_ready',
  variables: { 1: 'Karim' }
})
```

## Choose your setup

1. **Your own number (~ 2 minutes)**

   Create a free account on [nodium.io](https://nodium.io), connect your WhatsApp
   number from the console (Meta's sign-up, you can keep the WhatsApp Business
   app on your phone), create an API key, and send.

2. **Your clients' numbers (SaaS, agencies)**

   Create one client per customer of yours with its own identifier, send it the
   connect link that comes back, and act for it with `nodium.as(id)`. Your
   clients never see a Nodium screen, and one webhook receives the events of
   all of them.

   ```ts
   const client = await nodium.tenants.create(
     { name: 'Agence Horizon', externalId: 'crm-4187' },
     { connectLink: { redirectUrl: 'https://app.example.com/whatsapp' } }
   )
   console.log(client.connectLink.url) // send it to your client — shown only once

   const horizon = nodium.as('crm-4187') // adds the `Nodium-Tenant` header
   ```

## API surface

### Messaging

- [`messages`](#sending-messages) — `send` (every kind of message), `react`, `get`, `list`, `each`
- [`conversations`](#conversations-contacts--history) — `list`, `each`, `get`, `read`, `typing`
- [`templates`](#templates) — `list`, `get`, `create`, `update`, `delete`, `deploy`, `refresh`, `import`
- [`flows`](#flows) — `create`, `saveVersion`, `preview`, `publish`, `deprecate`, `duplicate`, `responses`, dynamic `dataEndpoint`…
- [`broadcasts`](#broadcasts) — `preview`, `send`, `get`, `list`, `cancel`, `resume`
- [`media`](#media) — `upload`, `list`, `each`, `download`, `remove`
- [`contacts`](#conversations-contacts--history) — `list`, `each`, `get`, `create`, `update`, `erase`, `exportCsv`
- [`channels`](#phone-numbers) — `list`, `get`, `check`, `update`, `profile`, `updateProfile`

### Account and operations

- [`tenants`](#your-clients) — your clients: `list`, `each`, `get`, `create`, `update`, `close`, `connectLink`, `channels`
- [`webhooks`](#webhooks) — subscriptions, `rotateSecret`, `test`, `deliveries`, `redeliver`
- [`events`](#event-log) — the numbered event log, read from a cursor
- `keys` · `connectLinks` · `stats.delivery` · `health()` · `billing.summary()`
- [`request()`](#raw-request) — any route the SDK does not wrap yet
- [`verifyWebhook`](#webhooks) · `signWebhook` · [`receiveFlowRequest`, `respondToFlow`, `flowError`, `completeFlow`](#dynamic-flows) — from `@nodium.io/whatsapp/server`

### Why Nodium?

- Meta's official WhatsApp Cloud API, connected in minutes.
- One key for your own number and every client's number.
- Signed webhooks, retried, in order per conversation — and an event log to catch up.
- Templates written once and deployed to each client's WhatsApp account.
- WhatsApp Flows and broadcasts to opted-in contacts.
- Hosted in the EU, built for the GDPR.
- Zero embedded AI: Nodium carries the messages, your code decides.
- A free plan that runs a real business: 3,000 messages a month, no card, no end date.

## Sending messages

`messages.send` is the one way to send, by number and person. Nodium finds the
conversation, or opens it. Assume `nodium` (or `horizon = nodium.as(id)`) is
created as above.

> **The 24-hour rule.** Free text, files and interactive messages are accepted
> only within 24 hours of the person's last message. To write first, send an
> approved [template](#templates).

### Text

```ts
await nodium.messages.send({ channelId, to: '+33612345678', type: 'text', text: 'See you tomorrow!' })
```

### Template

```ts
await nodium.messages.send({
  channelId,
  to: '+33612345678',
  type: 'template',
  templateName: 'booking_confirmed',
  templateLanguage: 'en',
  variables: { 1: 'Karim', 2: 'Friday 10:00' },
  buttons: [{ index: 0, type: 'url', text: 'bk-1042' }] // dynamic button values, if the template has any
})
```

### Image, video, audio, document

A file is uploaded first, then sent by its id (valid 7 days, reusable):

```ts
const file = await nodium.media.upload(new Blob([bytes], { type: 'application/pdf' }), { filename: 'quote.pdf' })

await nodium.messages.send({ channelId, to: '+33612345678', type: file.kind, mediaId: file.mediaId, caption: 'Your quote' })
```

`file.kind` is `image`, `video`, `audio` or `document`. An `audio/ogg` file can
go as a voice note with `voice: true`.

### Interactive buttons

```ts
await nodium.messages.send({
  channelId,
  to: '+33612345678',
  type: 'interactive',
  form: {
    kind: 'buttons',
    body: 'Your glasses are ready. When can you come by?',
    buttons: [{ id: 'tue-10', title: 'Tue 10:00' }, { id: 'thu-16', title: 'Thu 16:30' }]
  }
})
```

### Interactive list

```ts
await nodium.messages.send({
  channelId,
  to: '+33612345678',
  type: 'interactive',
  form: {
    kind: 'list',
    body: 'Which service?',
    buttonLabel: 'Choose',
    sections: [{ title: 'Car', rows: [{ id: 'oil', title: 'Oil change' }, { id: 'tyres', title: 'Tyres', description: 'Fitting included' }] }]
  }
})
```

### Location request

```ts
await nodium.messages.send({ channelId, to: '+33612345678', type: 'interactive', form: { kind: 'location_request', body: 'Where should we deliver?' } })
```

### Location

```ts
await nodium.messages.send({
  channelId,
  to: '+33612345678',
  type: 'location',
  location: { latitude: 48.8566, longitude: 2.3522, name: 'Garage Martin', address: '12 rue de Rivoli, Paris' }
})
```

### Contacts

```ts
await nodium.messages.send({
  channelId,
  to: '+33612345678',
  type: 'contacts',
  contacts: [{ name: { formatted_name: 'Garage Martin' }, phones: [{ phone: '+33140000000', type: 'WORK' }] }]
})
```

### Reaction

```ts
await nodium.messages.react({ channelId, to: '+33612345678', messageId: '<NODIUM_MESSAGE_ID>', emoji: '👍' }) // '' removes it
```

### Reply, queue, schedule

Every send also takes `replyToId` (quote an earlier message), `queue: true`
(answer at once with HTTP 202, the message leaves within the minute) and
`scheduledAt` (ISO 8601, at least a minute ahead).

### Mark as read and typing indicator

```ts
await nodium.conversations.read(conversationId)   // the read receipt of the last message received
await nodium.conversations.typing(conversationId) // "typing…" while your code prepares the answer
```

### Idempotency and refused sends

`messages.send` always carries an idempotency key. Pass your own
(`idempotencyKey`, 8–200 characters) to make a call replayable across processes;
otherwise the SDK draws one, fixed for the whole call, so an automatic retry can
never send twice. A replayed key answers `duplicate: true` and sends nothing.

**A refused send is not an exception.** When Meta refuses a message, the call
still resolves with `message.status === 'failed'`; `message.errorInfo` says what
happened, what to do, and who acts (`you`, `client`, `nodium` or `wait`).

```ts
const { message } = await nodium.messages.send({ channelId, to: '+33612345678', type: 'text', text: 'Hello' })
if (message?.status === 'failed') console.error(message.errorInfo?.title, message.errorInfo?.action)
```

## Recipients without a phone number

Every send takes `to` (a number in E.164 form) **or** `recipient` (`wa:…`, the
WhatsApp user id of a contact who shows no number) — never both.

```ts
await nodium.messages.send({ channelId, recipient: 'wa:…', type: 'text', text: 'Thanks!' })
```

## Flows

WhatsApp forms inside the conversation: write the `flow.json`, publish it, send
it from a button, read the answers.

### Create and publish a Flow

```ts
const { flow } = await nodium.flows.create({ name: 'Booking', categories: ['APPOINTMENT_BOOKING'] })
const { validationErrors } = await nodium.flows.saveVersion(flow.id, myFlowJson) // Meta validates it
console.log((await nodium.flows.preview(flow.id)).previewUrl)                   // see it as on a phone
await nodium.flows.publish(flow.id)                                             // final: a published Flow no longer changes
```

### Send a Flow message

```ts
await nodium.messages.send({
  channelId,
  to: '+33612345678',
  type: 'interactive',
  text: 'Pick a slot for your visit.',
  form: { kind: 'flow', flowId: flow.metaFlowId, buttonLabel: 'Book', flowToken: 'visit-1042' }
})
```

### Open a Flow from a template

A Flow sent as an interactive message only goes out within the 24-hour window.
To open it **for someone who has not written** — or in a broadcast — put it on
an approved template: one `FLOW` button per template.

```ts
const { template } = await nodium.templates.create({
  name: 'service_reminder',
  language: 'en',
  category: 'UTILITY',
  body: 'Your car is due for its service, {{1}}. Pick a slot in a few taps.',
  buttons: [{ type: 'FLOW', text: 'Book a slot', flowId: flow.id, screen: 'SLOTS' }] // screen: optional
})
await nodium.templates.deploy(template.id) // the Flow must be published by then

await nodium.messages.send({
  channelId,
  to: '+33612345678',
  type: 'template',
  templateName: 'service_reminder',
  variables: { 1: 'Karim' },
  buttons: [{ index: 0, type: 'flow', flowToken: 'visit-1042' }] // optional: comes back with the answer
})
```

In each WhatsApp account of the client, Nodium opens the Flow of the same
name; a dynamic Flow asks your service for its first screen.

### Read the answers

Each answer reaches your webhook as `message.received` with
`data.reply.kind === 'flow'` and the fields in `data.reply.data`. You can also
read them back:

```ts
const { items } = await nodium.flows.responses({ flowToken: 'visit-1042' })
console.log(items[0]?.data) // { service: 'oil_change', date: '2026-10-14', slot: '09:30' }
```

### Dynamic Flows

A dynamic Flow asks your server on each screen (available slots, a price, a
lookup). `flows.setDataEndpoint(id, url)` on a draft returns a signing `secret`
(shown once). Nodium decrypts Meta's encrypted calls and relays them to your
URL, signed like webhooks; your JSON answer is encrypted and handed back to
Meta. You never touch Meta's encryption.

```ts
import express from 'express'
import { completeFlow, flowError, receiveFlowRequest, respondToFlow } from '@nodium.io/whatsapp/server'

app.post('/whatsapp/flow', express.raw({ type: 'application/json' }), async (req, res) => {
  const call = receiveFlowRequest(req.body, req.headers, process.env.NODIUM_FLOW_SECRET!)
  // call.action: 'INIT' | 'data_exchange' | 'BACK' · call.screen · call.data · call.flowToken

  if (call.action === 'INIT') return res.json(respondToFlow({ screen: 'SLOTS', data: { days: await nextDays() } }))
  if (call.screen === 'SLOTS') {
    const slots = await freeSlots(call.data.date as string)
    if (!slots.length) return res.json(flowError('SLOTS', 'No slot left that day.'))
    return res.json(respondToFlow({ screen: 'CONFIRM', data: { slots } }))
  }
  res.json(completeFlow(call.flowToken, { booked: true })) // closes the Flow; the answer reaches your webhook
})
```

Answer within about 9 seconds: past that, the customer sees "the service does
not respond" on the current screen. `call.test` is `true` for the console's
test call. `flows.invocations(id)` lists the last calls.

## Templates

A template belongs to one client and is deployed to the WhatsApp accounts of
that client's numbers; only an `approved` template can be sent.

```ts
const { template } = await nodium.templates.create({
  name: 'order_ready',
  language: 'en',
  category: 'UTILITY',
  body: 'Hello {{1}}, your order is ready.',
  footer: 'Garage Martin'
})
const { results } = await nodium.templates.deploy(template.id) // one outcome per WhatsApp account
await nodium.templates.refresh(template.id)                    // re-read the status from Meta
await nodium.templates.import()                                // bring in templates that already exist at Meta
```

Status changes also arrive as the `template.status_changed` webhook.

## Broadcasts

An approved template sent to many people in one call, from a queue, at the pace
Meta allows the number. **Only contacts who opted in receive it**; anyone who
opted out or is blocked is left out and counted.

```ts
const preview = await nodium.broadcasts.preview({ allOptIn: true }) // { recipients, withoutConsent, … }

const { id } = await nodium.broadcasts.send({
  name: "Autumn sale",
  whatsappTemplateId: template.id,
  allOptIn: true // or contactIds: [...], up to 10,000
})

const broadcast = await nodium.broadcasts.get(id) // status and counts
await nodium.broadcasts.cancel(id)                // withdraw what has not left yet
await nodium.broadcasts.resume(id)                // after a pause on repeated refusals
```

## Conversations, contacts & history

```ts
const page = await nodium.conversations.list({ phone: '+33 6 12 34 56 78' })
for await (const message of nodium.messages.each(page.items[0].id)) console.log(message.direction, message.textContent)

const contact = await nodium.contacts.create({ displayName: 'Karim', phone: '+33612345678' })
await nodium.contacts.update(contact.id, { optIn: true })
const csv = await nodium.contacts.exportCsv({ consent: 'in' })
await nodium.contacts.erase(contact.id, 'Karim') // GDPR erasure: the contact, its messages and threads
```

A message written from the phone of a coexistence number has `origin: 'phone'`;
history imported from the phone has `imported: true`.

## Media

```ts
for await (const file of nodium.media.each({ kind: 'document' })) console.log(file.messageId)

const response = await nodium.media.download(messageId) // a fetch Response: stream it or read it
await nodium.media.remove(messageId)                    // delete the stored copy
```

Media received from your contacts arrive in the webhook as `data.media.url`
(Nodium's copy, behind your key).

## Phone numbers

```ts
const numbers = await nodium.channels.list()
const detail = await nodium.channels.get(numbers[0].id) // quality, messaging limit, coexistence, health
await nodium.channels.check(numbers[0].id)              // a fresh health check at Meta
await nodium.channels.updateProfile(numbers[0].id, { about: 'Opticians since 1987', websites: ['https://example.com'] })
```

## Your clients

```ts
for await (const tenant of nodium.tenants.each()) console.log(tenant.name)

const link = await nodium.tenants.connectLink(client.id, { expiresInDays: 14 }) // a new link — shown only once, single use
const numbers = await nodium.tenants.channels(client.id)
```

Without `as()`, calls act on "My company" — or on the client a key is pinned to.
`as(id)` takes Nodium's id or your own `externalId`.

## Webhooks

Verify the signature of the **raw** body, answer `2xx`, work afterwards.

```ts
import express from 'express'
import { NodiumSignatureError, verifyWebhook } from '@nodium.io/whatsapp/server'

app.post('/webhooks/nodium', express.raw({ type: 'application/json' }), (req, res) => {
  try {
    const event = verifyWebhook(req.body, req.headers, process.env.NODIUM_WEBHOOK_SECRET!)
    if (event.event === 'message.received') console.log(event.external_id, event.data.text)
    res.sendStatus(200) // event.id is the same on every redelivery: deduplicate on it
  } catch (error) {
    if (error instanceof NodiumSignatureError) return res.sendStatus(400)
    throw error
  }
})
```

- Never verify a re-serialised body. During a secret rotation, pass both secrets as an array.
- Calls older than 5 minutes are refused (`toleranceSeconds`).
- A subscription of "My company" also receives the events of every client of the account; `external_id` says which.

Manage subscriptions from code:

```ts
const { id, secret } = await nodium.webhooks.create({ url: 'https://app.example.com/webhooks/nodium', events: ['message.received', 'message.failed'] })
await nodium.webhooks.test(id)
await nodium.webhooks.rotateSecret(id) // the old secret stays valid for a while
for await (const delivery of nodium.webhooks.eachDelivery({ status: 'failed' })) await nodium.webhooks.redeliver(delivery.id)
```

## Event log

The webhook is a doorbell, the event log is the truth: every event Nodium emits
is also written to a numbered log, kept 30 days. Read it from a cursor, and a
delivery that never came costs you nothing.

```ts
let after = (await nodium.events.list()).next_after // no `after`: the head, your first cursor
for (;;) {
  const page = await nodium.events.list(after, 200)   // at most 500
  for (const entry of page.data) store(entry)          // the webhook envelope + `seq`; entry.id deduplicates
  if (page.next_after === after) break                 // up to date: come back at the next webhook
  after = page.next_after                              // keep it once the page is stored
}
```

A cursor older than the log answers 410 `cursor_expired`: restart from `after = 0`.

## Pagination

A list that takes `limit` and `cursor` returns a page (`{ items, nextCursor, hasMore }`)
and has an `each()` that walks every page. A list returned whole (`channels`,
`keys`, `flows`…) is a plain array.

## Error handling

Every refusal is a `NodiumError` with `status`, `code` (stable — branch on it),
`message`, `detail`, `requestId` (give it to support), `retryAfter` and `data`.
A network failure has `status: 0` and `code: 'network_error'` or `'timeout'`.

`error.retry` says what to do — `{ action: 'retry' | 'retry_after' | 'fix_and_retry' | 'upgrade' | 'do_not_retry', retryAfterMs? }`
— and `isAuthError()`, `isRateLimit()`, `isNotFound()`, `isNetworkError()` and
`isPlanLimit` answer the usual questions.

```ts
import { NodiumError } from '@nodium.io/whatsapp'

try {
  await nodium.tenants.create({ name: 'Horizon', externalId: 'crm-4187' })
} catch (error) {
  if (error instanceof NodiumError && error.code === 'tenant_exists') {
    // error.data.tenantId is the existing client
  }
}
```

429 and 5xx are retried (`maxRetries`, default 2) after `Retry-After`, or an
exponential backoff. **A write without an idempotency key is never retried.**

## Raw request

A route the SDK does not wrap yet: same key, same client header, same retries.
`data` is returned.

```ts
const status = await nodium.as('crm-4187').request<{ channels: unknown[] }>({ method: 'GET', path: '/flows/encryption' })
```

A write is retried only with an `idempotencyKey`.

## Options

```ts
new Nodium(key, {
  baseUrl: 'https://nodium.io/api/v1', // the default
  fetch: customFetch,                  // your own fetch (proxy, tests)
  timeoutMs: 30_000,                   // the default
  maxRetries: 2                        // the default
})
```

## Typed responses

Every method returns typed data (`Message`, `Conversation`, `Template`, `Flow`,
`Broadcast`, `Contact`, `Channel`…), and webhook events are a discriminated
union on `event` (`NodiumEvent`). All types are exported from the package.

## Develop locally

The `nodium` command lives in its own package,
[`@nodium.io/cli`](https://www.npmjs.com/package/@nodium.io/cli): the same API
from your terminal (`nodium status`, `numbers`, `templates`, `webhooks`…), and
your events replayed to your local server, signed like production, with no
tunnel and no public address.

```bash
npx @nodium.io/cli listen --forward http://localhost:3000/webhook --secret whsec_…
```

## License

MIT © By-Tech.io
