// A SaaS connecting its customers' WhatsApp: one client per customer, one key for all.
import { Nodium } from '@nodium.io/whatsapp'

const nodium = new Nodium(process.env.NODIUM_KEY!)

// 1. Add your customer as a client, under your own identifier, with a hosted connect link.
const client = await nodium.tenants.create(
  { name: 'Agence Horizon', externalId: 'crm-4187' },
  { connectLink: { redirectUrl: 'https://app.example.com/whatsapp' } }
)
console.log('Send this link to your customer (shown once):', client.connectLink.url)

// 2. Once they have connected their number, act for them: same key, your identifier.
const horizon = nodium.as('crm-4187') // adds Nodium-Tenant to every call
const [channel] = await horizon.channels.list()
if (channel) {
  await horizon.messages.send({
    channelId: channel.id,
    to: '+33612345678',
    type: 'template',
    templateName: 'appointment_reminder',
    variables: { 1: 'Thursday at 6 pm' }
  })
}
