export type SentMessageMetadata = {
  id: string | null
  timestamp?: number
  state: 'confirmed' | 'submitted'
}

export function getSentMessageId(result: any): string | null {
  const rawId = result?.id

  if (typeof rawId === 'string' && rawId.trim()) return rawId
  if (typeof rawId?._serialized === 'string' && rawId._serialized.trim()) return rawId._serialized
  if (typeof rawId?.$1 === 'string' && rawId.$1.trim()) return rawId.$1

  const dataId = result?._data?.id
  if (typeof dataId === 'string' && dataId.trim()) return dataId
  if (typeof dataId?._serialized === 'string' && dataId._serialized.trim()) return dataId._serialized
  if (typeof dataId?.$1 === 'string' && dataId.$1.trim()) return dataId.$1

  const idObject = rawId || dataId
  const remote = idObject?.remote?._serialized ?? idObject?.remote?.$1 ?? idObject?.remote
  const stanza = idObject?.id?._serialized ?? idObject?.id?.$1 ?? idObject?.id
  const participant = idObject?.participant?._serialized ?? idObject?.participant?.$1 ?? idObject?.participant
  if (typeof remote === 'string' && remote && typeof stanza === 'string' && stanza) {
    return `${Boolean(idObject?.fromMe)}_${remote}_${stanza}${participant ? `_${participant}` : ''}`
  }

  return null
}

export function getSentMessageMetadata(result: any, destination: string): SentMessageMetadata {
  const id = getSentMessageId(result)
  if (id) {
    return {
      id,
      timestamp: typeof result?.timestamp === 'number' ? result.timestamp : undefined,
      state: 'confirmed',
    }
  }

  if (result?.__singleAttemptReceipt === true && result?.submitted === true) {
    return {
      id: null,
      timestamp: result.timestamp,
      state: 'submitted',
    }
  }

  throw new Error(
    `The single WhatsApp send call for ${destination} failed before it was accepted. No retry or resend was performed.`
  )
}

export function requireSentMessageMetadata(result: any, destination: string): SentMessageMetadata {
  return getSentMessageMetadata(result, destination)
}
