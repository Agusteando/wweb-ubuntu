import { Message } from 'whatsapp-web.js'

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error

  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

export async function getQuotedMessageSafely(message: Message, context: string): Promise<Message | null> {
  if (!message.hasQuotedMsg) return null

  try {
    const quotedMessage = await message.getQuotedMessage()
    if (!quotedMessage) {
      console.warn(`[${context}] WhatsApp reported a quoted message, but it is no longer available.`)
      return null
    }

    return quotedMessage
  } catch (error) {
    console.warn(`[${context}] Unable to resolve quoted message: ${describeError(error)}`)
    return null
  }
}
