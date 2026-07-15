export type SentMessageMetadata = {
  id: string
  timestamp?: number
}

export function getSentMessageId(result: any): string | null {
  const rawId = result?.id

  if (typeof rawId === 'string' && rawId.trim()) return rawId
  if (typeof rawId?._serialized === 'string' && rawId._serialized.trim()) return rawId._serialized

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
