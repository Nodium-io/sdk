// List your connected numbers, then write first to a customer with an approved template.
import { Nodium } from '@nodium.io/whatsapp'

const nodium = new Nodium(process.env.NODIUM_KEY!)

const [channel] = await nodium.channels.list()
if (!channel) throw new Error('No WhatsApp number connected yet: connect one in the console.')

const { message } = await nodium.messages.send({
  channelId: channel.id,
  to: '+33612345678',
  type: 'template', // a first message is always an approved template
  templateName: 'order_ready',
  variables: { 1: 'Karim' }
})

// A send refused by WhatsApp is still an HTTP 200: test the status.
if (message?.status === 'failed') console.error(message.errorInfo?.title)
else console.log('sent', message?.id)
