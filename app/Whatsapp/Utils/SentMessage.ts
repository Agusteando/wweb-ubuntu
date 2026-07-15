export type SentMessageMetadata = {
  id: string
  timestamp?: number
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

export function requireSentMessageMetadata(result: any, destination: string): SentMessageMetadata {
  const id = getSentMessageId(result)
  if (!id) {
    throw new Error(
      `WhatsApp did not confirm message delivery to ${destination}. The chat may be unavailable, the client session may be stale, or WhatsApp Web returned an empty result.`
    )
  }

  return {
    id,
    timestamp: typeof result?.timestamp === 'number' ? result.timestamp : undefined,
  }
}
