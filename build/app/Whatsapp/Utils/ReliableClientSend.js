"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.installReliableClientSend = exports.isSingleAttemptSendReceipt = void 0;
const SentMessage_1 = global[Symbol.for('ioc.use')]("App/Whatsapp/Utils/SentMessage");
const ChatId_1 = global[Symbol.for('ioc.use')]("App/Whatsapp/Utils/ChatId");
const installedClients = new WeakSet();
function isSingleAttemptSendReceipt(value) {
    return Boolean(value?.__singleAttemptReceipt === true && value?.submitted === true);
}
exports.isSingleAttemptSendReceipt = isSingleAttemptSendReceipt;
function installReliableClientSend(client, clientId = 'unknown') {
    if (installedClients.has(client))
        return;
    installedClients.add(client);
    const originalSendMessage = client.sendMessage.bind(client);
    const queues = new Map();
    client.sendMessage = async (requestedChatId, content, options = {}) => {
        const chatId = await (0, ChatId_1.resolveCanonicalChatId)(client, requestedChatId);
        const previous = queues.get(chatId) ?? Promise.resolve();
        const operation = previous
            .catch(() => undefined)
            .then(async () => {
            const result = await originalSendMessage(chatId, content, {
                ...options,
                waitUntilMsgSent: true,
            });
            const directId = (0, SentMessage_1.getSentMessageId)(result);
            if (directId && result?.id && typeof result.id === 'object' && !result.id._serialized) {
                result.id._serialized = directId;
            }
            if (result)
                return result;
            console.warn(`[outbound:${clientId}] WhatsApp accepted the single send call for ${chatId} but returned no Message object. No retry or resend was performed.`);
            return {
                __singleAttemptReceipt: true,
                submitted: true,
                destination: chatId,
                timestamp: Math.floor(Date.now() / 1000),
            };
        });
        const queueTail = operation.then(() => undefined, () => undefined);
        queues.set(chatId, queueTail);
        queueTail.finally(() => {
            if (queues.get(chatId) === queueTail)
                queues.delete(chatId);
        });
        return operation;
    };
}
exports.installReliableClientSend = installReliableClientSend;
//# sourceMappingURL=ReliableClientSend.js.map