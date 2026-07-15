"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getQuotedMessageSafely = void 0;
function describeError(error) {
    if (error instanceof Error)
        return error.message;
    if (typeof error === 'string')
        return error;
    try {
        return JSON.stringify(error);
    }
    catch {
        return String(error);
    }
}
async function getQuotedMessageSafely(message, context) {
    if (!message.hasQuotedMsg)
        return null;
    try {
        const quotedMessage = await message.getQuotedMessage();
        if (!quotedMessage) {
            console.warn(`[${context}] WhatsApp reported a quoted message, but it is no longer available.`);
            return null;
        }
        return quotedMessage;
    }
    catch (error) {
        console.warn(`[${context}] Unable to resolve quoted message: ${describeError(error)}`);
        return null;
    }
}
exports.getQuotedMessageSafely = getQuotedMessageSafely;
//# sourceMappingURL=QuotedMessage.js.map