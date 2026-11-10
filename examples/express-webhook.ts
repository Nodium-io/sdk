// Receive WhatsApp messages on an Express route, check the signature, reply.
import express from 'express'
import { Nodium } from '@nodium.io/whatsapp'
import { NodiumSignatureError, verifyWebhook } from '@nodium.io/whatsapp/server'

const nodium = new Nodium(process.env.NODIUM_KEY!)
const app = express()

// express.raw: the signature is computed on the body exactly as received.
app.post('/webhooks/nodium', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const event = verifyWebhook(req.body, req.headers, process.env.NODIUM_WEBHOOK_SECRET!)

    if (event.event === 'message.received' && event.data.type === 'text') {
      await nodium.messages.send({
        channelId: String(event.data.channel_id),
        to: String(event.data.from),
        type: 'text',
        text: `You wrote: ${event.data.text}`,
        idempotencyKey: `reply-${event.id}` // the same on every redelivery: sent once
      })
    }
    res.sendStatus(200)
  } catch (error) {
    if (error instanceof NodiumSignatureError) return res.sendStatus(400)
    throw error
  }
})

app.listen(3000, () => console.log('listening on http://localhost:3000/webhooks/nodium'))
