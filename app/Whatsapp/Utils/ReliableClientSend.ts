import { Client } from 'whatsapp-web.js'
import { getSentMessageId } from 'App/Whatsapp/Utils/SentMessage'
import { resolveCanonicalChatId } from 'App/Whatsapp/Utils/ChatId'

type SendOptions = Record<string, any>
type SendContent = any

export type SingleAttemptSendReceipt = {
  __singleAttemptReceipt: true
  submitted: true
  destination: string
  timestamp: number
}

const installedClients = new WeakSet<object>()

export function isSingleAttemptSendReceipt(value: any): value is SingleAttemptSendReceipt {
  return Boolean(value?.__singleAttemptReceipt === true && value?.submitted === true)
}

/**
 * Installs one and only one outbound WhatsApp invocation per application call.
 *
 * This wrapper deliberately does not poll chat history, retry, resend, or invoke
 * any fallback send path. A resolved call without a Message object is returned as
 * a submitted receipt so API callers do not receive a false 5xx and retry a send
 * that WhatsApp may already have accepted.
 */
export function installReliableClientSend(client: Client, clientId = 'unknown'): void {
  if (installedClients.has(client as any)) return
  installedClients.add(client as any)

  const originalSendMessage = client.sendMessage.bind(client)
  const queues = new Map<string, Promise<void>>()

  ;(client as any).sendMessage = async (
    requestedChatId: string,
    content: SendContent,
    options: SendOptions = {}
  ) => {
    const chatId = await resolveCanonicalChatId(client, requestedChatId)
    const previous = queues.get(chatId) ?? Promise.resolve()

    const operation = previous
      .catch(() => undefined)
      .then(async () => {
        const result = await originalSendMessage(chatId, content, {
          ...options,
          waitUntilMsgSent: true,
        })

        const directId = getSentMessageId(result)
        if (directId && result?.id && typeof result.id === 'object' && !result.id._serialized) {
          result.id._serialized = directId
        }

        if (result) return result

        console.warn(
          `[outbound:${clientId}] WhatsApp accepted the single send call for ${chatId} but returned no Message object. No retry or resend was performed.`
        )

        return {
          __singleAttemptReceipt: true,
          submitted: true,
          destination: chatId,
          timestamp: Math.floor(Date.now() / 1000),
        } as SingleAttemptSendReceipt
      })

    const queueTail = operation.then(
      () => undefined,
      () => undefined
    )
    queues.set(chatId, queueTail)
    queueTail.finally(() => {
      if (queues.get(chatId) === queueTail) queues.delete(chatId)
    })

    return operation
  }
}
