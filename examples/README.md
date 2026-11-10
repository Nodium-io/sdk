# Examples

Each example receives a WhatsApp message and replies, or sends one. They all read two environment variables:

```bash
export NODIUM_KEY=nod_…                 # console › Settings › API keys
export NODIUM_WEBHOOK_SECRET=whsec_…    # shown once, when you create the webhook
```

Create the webhook that points to your server:

```bash
curl https://nodium.io/api/v1/webhooks \
  -H "Authorization: Bearer $NODIUM_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "url": "https://your-app.example.com/webhooks/nodium", "events": ["message.received"] }'
```

In development, `npx @nodium.io/cli listen` replays your real events to `localhost`, without a tunnel.

| File | Run it |
|---|---|
| `send-message.ts` | `npm i @nodium.io/whatsapp && npx tsx send-message.ts` |
| `express-webhook.ts` | `npm i @nodium.io/whatsapp express && npx tsx express-webhook.ts` |
| `multi-tenant.ts` | `npm i @nodium.io/whatsapp && npx tsx multi-tenant.ts` |
| `nextjs-webhook/route.ts` | copy to `app/api/webhooks/nodium/route.ts` in a Next.js app |
| `python-fastapi/main.py` | `pip install fastapi uvicorn httpx && uvicorn main:app` |
| `laravel-webhook/api.php` | copy the route into `routes/api.php` |

Two rules apply to every integration:

- **Verify the signature on the raw body**, before any JSON parsing.
- **Free text only goes out within 24 hours** of the customer's last message. To write first, send an approved template.
