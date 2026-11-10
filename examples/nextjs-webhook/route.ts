// app/api/webhooks/nodium/route.ts
import { Nodium } from '@nodium.io/whatsapp'
import { NodiumSignatureError, verifyWebhook } from '@nodium.io/whatsapp/server'

const nodium = new Nodium(process.env.NODIUM_KEY!)

export async function POST(request: Request) {
  // The raw body, before any JSON parsing: the signature is computed on it.
  const rawBody = await request.text()
  try {
    const event = verifyWebhook(rawBody, request.headers, process.env.NODIUM_WEBHOOK_SECRET!)

    if (event.event === 'message.received' && event.data.type === 'text') {
      await nodium.messages.send({
        channelId: String(event.data.channel_id),
        to: String(event.data.from),
        type: 'text',
        text: `You wrote: ${event.data.text}`,
        idempotencyKey: `reply-${event.id}`   // the same on every redelivery: sent once
      })
    }
    return new Response(null, { status: 200 })
  } catch (error) {
    if (error instanceof NodiumSignatureError) return new Response(null, { status: 400 })
    throw error
  }
}
