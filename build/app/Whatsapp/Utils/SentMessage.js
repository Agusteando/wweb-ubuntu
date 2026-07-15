"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireSentMessageMetadata = exports.getSentMessageId = void 0;
function getSentMessageId(result) {
    const rawId = result?.id;
    if (typeof rawId === 'string' && rawId.trim())
        return rawId;
    if (typeof rawId?._serialized === 'string' && rawId._serialized.trim())
        return rawId._serialized;
    return null;
}
exports.getSentMessageId = getSentMessageId;
function requireSentMessageMetadata(result, destination) {
    const id = getSentMessageId(result);
    if (!id) {
        throw new Error(`WhatsApp did not confirm message delivery to ${destination}. The chat may be unavailable, the client session may be stale, or WhatsApp Web returned an empty result.`);
    }
    return {
        id,
        timestamp: typeof result?.timestamp === 'number' ? result.timestamp : undefined,
    };
}
exports.requireSentMessageMetadata = requireSentMessageMetadata;
//# sourceMappingURL=SentMessage.js.map