# Nodium SDK

[![npm](https://img.shields.io/npm/v/@nodium.io/whatsapp.svg?label=%40nodium.io%2Fwhatsapp)](https://www.npmjs.com/package/@nodium.io/whatsapp)
[![npm](https://img.shields.io/npm/v/@nodium.io/cli.svg?label=%40nodium.io%2Fcli)](https://www.npmjs.com/package/@nodium.io/cli)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

The TypeScript SDK and the command line of [Nodium](https://nodium.io), the WhatsApp API gateway for developers and SaaS builders.

Nodium connects your backend to WhatsApp through Meta's official Cloud API: you receive each message by signed webhook and reply through a REST API. It carries messages and never decides what to reply.

| Package | What it is | Install |
|---|---|---|
| [`@nodium.io/whatsapp`](./packages/whatsapp) | TypeScript client: send, receive, templates, Flows, broadcasts, your customers' numbers behind one key | `npm i @nodium.io/whatsapp` |
| [`@nodium.io/cli`](./packages/cli) | The `nodium` command: numbers, templates and webhooks from the terminal, and your events replayed to `localhost` | `npm i -g @nodium.io/cli` |

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

Receive messages on a webhook, with the signature checked for you:

```ts
import { verifyWebhook } from '@nodium.io/whatsapp/server'

const event = verifyWebhook(rawBody, headers, process.env.NODIUM_WEBHOOK_SECRET!)
if (event.event === 'message.received') console.log(event.data.from, event.data.text)
```

Create a free account at [nodium.io](https://nodium.io): 3,000 messages a month and one number, no card.

## Examples

Ready-to-copy integrations, in [`examples/`](./examples):

| Example | Stack |
|---|---|
| [`send-message`](./examples/send-message.ts) | Node.js: list your numbers, send a template |
| [`express-webhook`](./examples/express-webhook.ts) | Express: verify the signature, reply |
| [`nextjs-webhook`](./examples/nextjs-webhook/route.ts) | Next.js route handler |
| [`multi-tenant`](./examples/multi-tenant.ts) | SaaS: one client per customer, a hosted connect link |
| [`python-fastapi`](./examples/python-fastapi/main.py) | Python, no SDK: the REST API and an HMAC check |
| [`laravel-webhook`](./examples/laravel-webhook/api.php) | PHP, no SDK: a Laravel route |

## Not using TypeScript?

The API is plain REST, described in OpenAPI 3.1. Any language that speaks HTTP works.

- API guide: https://nodium.io/en/docs/api
- API reference: https://nodium.io/en/docs/api/reference
- OpenAPI: https://nodium.io/docs/api/openapi.json

## For AI coding agents

- `AGENTS.md`, the integration sheet for coding agents: https://nodium.io/agents.md
- `llms.txt`: https://nodium.io/llms.txt · everything in one file: https://nodium.io/llms-full.txt
- MCP server, to operate WhatsApp from an agent with your API key: `https://nodium.io/api/v1/mcp` ([guide](https://nodium.io/en/docs/api/guide/mcp))

```bash
claude mcp add --transport http nodium https://nodium.io/api/v1/mcp \
  --header "Authorization: Bearer $NODIUM_KEY"
```

## Learn more

- [How to add WhatsApp to your SaaS](https://nodium.io/en/guides/add-whatsapp-to-your-saas)
- [The WhatsApp 24-hour window, explained](https://nodium.io/en/guides/24-hour-window)
- [WhatsApp API pricing: what Meta charges](https://nodium.io/en/guides/meta-pricing)
- [Pricing](https://nodium.io/en/pricing) · [Security](https://nodium.io/en/security) · [Status](https://nodium.io/en/status)

## Support

Questions and bugs: open an issue here, or write to contact@nodium.io.

## License

MIT © By-Tech.io
