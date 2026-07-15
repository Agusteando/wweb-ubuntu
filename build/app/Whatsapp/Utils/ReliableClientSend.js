"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.installReliableClientSend = void 0;
const whatsapp_web_js_1 = require("whatsapp-web.js");
const SentMessage_1 = global[Symbol.for('ioc.use')]("App/Whatsapp/Utils/SentMessage");
const installedClients = new WeakSet();
function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
function buildSignature(content, options) {
    if (typeof content === 'string') {
        return {
            kind: options?.media ? 'media' : 'text',
            body: options?.media ? undefined : content,
            caption: typeof options?.caption === 'string' ? options.caption : undefined,
            mimetype: options?.media?.mimetype,
            filename: options?.media?.filename,
        };
    }
    if (content instanceof whatsapp_web_js_1.MessageMedia || (content && typeof content === 'object' && content.data && content.mimetype)) {
        return {
            kind: 'media',
            caption: typeof options?.caption === 'string' ? options.caption : undefined,
            mimetype: content.mimetype,
            filename: content.filename || undefined,
        };
    }
    return { kind: 'other' };
}
async function snapshotOutgoingIds(client, chatId) {
    const page = client.pupPage;
    if (!page?.evaluate)
        return [];
    try {
        return await page.evaluate(async ({ chatId: targetChatId }) => {
            const w = globalThis;
            const serialized = (value) => {
                if (!value)
                    return undefined;
                if (typeof value === 'string')
                    return value;
                return value._serialized ?? value.$1;
            };
            const buildId = (id) => {
                const direct = serialized(id);
                if (direct)
                    return direct;
                const remote = serialized(id?.remote);
                const stanza = serialized(id?.id) ?? (typeof id?.id === 'string' ? id.id : undefined);
                if (!remote || !stanza)
                    return undefined;
                const participant = serialized(id?.participant);
                return `${Boolean(id?.fromMe)}_${remote}_${stanza}${participant ? `_${participant}` : ''}`;
            };
            let chat;
            try {
                chat = await w.WWebJS.getChat(targetChatId, { getAsModel: false });
            }
            catch (_error) {
                chat = null;
            }
            if (!chat?.msgs?.getModelsArray)
                return [];
            return chat.msgs
                .getModelsArray()
                .filter((model) => Boolean(model?.id?.fromMe ?? model?.fromMe))
                .slice(-200)
                .map((model) => buildId(model?.id))
                .filter(Boolean);
        }, { chatId });
    }
    catch (_error) {
        return [];
    }
}
async function findNewOutboundMessage(client, chatId, beforeIds, startedAt, signature) {
    const page = client.pupPage;
    if (!page?.evaluate)
        return null;
    try {
        return await page.evaluate(async ({ targetChatId, knownIds, since, expected }) => {
            const w = globalThis;
            const serialized = (value) => {
                if (!value)
                    return undefined;
                if (typeof value === 'string')
                    return value;
                return value._serialized ?? value.$1;
            };
            const buildId = (id) => {
                const direct = serialized(id);
                if (direct)
                    return direct;
                const remote = serialized(id?.remote);
                const stanza = serialized(id?.id) ?? (typeof id?.id === 'string' ? id.id : undefined);
                if (!remote || !stanza)
                    return undefined;
                const participant = serialized(id?.participant);
                return `${Boolean(id?.fromMe)}_${remote}_${stanza}${participant ? `_${participant}` : ''}`;
            };
            const normalize = (value, depth = 0) => {
                if (!value || typeof value !== 'object' || depth > 10)
                    return value;
                if (Array.isArray(value)) {
                    for (const item of value)
                        normalize(item, depth + 1);
                    return value;
                }
                if (value.$1 !== undefined && value._serialized === undefined)
                    value._serialized = value.$1;
                for (const key of Object.keys(value))
                    normalize(value[key], depth + 1);
                return value;
            };
            const toModelData = (model) => {
                try {
                    if (w.WWebJS?.getMessageModel)
                        return normalize(w.WWebJS.getMessageModel(model));
                }
                catch (_error) { }
                try {
                    return normalize(model?.serialize ? model.serialize() : model);
                }
                catch (_error) {
                    return null;
                }
            };
            let chat;
            try {
                chat = await w.WWebJS.getChat(targetChatId, { getAsModel: false });
            }
            catch (_error) {
                chat = null;
            }
            if (!chat?.msgs?.getModelsArray)
                return null;
            const known = new Set(knownIds || []);
            const candidates = chat.msgs
                .getModelsArray()
                .filter((model) => Boolean(model?.id?.fromMe ?? model?.fromMe))
                .filter((model) => {
                const id = buildId(model?.id);
                if (!id || known.has(id))
                    return false;
                const timestamp = Number(model?.t ?? model?.timestamp ?? 0);
                return !timestamp || timestamp >= since - 3;
            });
            let best = null;
            let bestScore = -1;
            for (const model of candidates) {
                const mediaData = model?.mediaData ?? model?.mediaObject ?? null;
                const modelBody = String(model?.body ?? model?.caption ?? mediaData?.caption ?? '');
                const modelCaption = String(model?.caption ?? mediaData?.caption ?? model?.body ?? '');
                const modelMime = String(model?.mimetype ?? mediaData?.mimetype ?? '');
                const modelFilename = String(model?.filename ?? mediaData?.filename ?? '');
                const hasMedia = Boolean(model?.mediaData || model?.mediaObject || model?.type === 'document' || model?.type === 'image' || model?.type === 'video' || model?.type === 'audio');
                let score = Number(model?.t ?? model?.timestamp ?? 0) / 1000000000;
                if (expected.kind === 'text') {
                    if (modelBody === String(expected.body ?? ''))
                        score += 100;
                    else if (expected.body && modelBody.includes(String(expected.body)))
                        score += 50;
                    else
                        continue;
                }
                else if (expected.kind === 'media') {
                    if (!hasMedia)
                        continue;
                    score += 20;
                    if (expected.filename && modelFilename === expected.filename)
                        score += 100;
                    else if (expected.filename && modelFilename)
                        score -= 10;
                    if (expected.mimetype && modelMime === expected.mimetype)
                        score += 60;
                    if (expected.caption && modelCaption === expected.caption)
                        score += 50;
                }
                else {
                    score += 10;
                }
                if (score > bestScore) {
                    best = model;
                    bestScore = score;
                }
            }
            return best ? toModelData(best) : null;
        }, {
            targetChatId: chatId,
            knownIds: beforeIds,
            since: startedAt,
            expected: signature,
        });
    }
    catch (_error) {
        return null;
    }
}
async function verifyOutboundMessage(client, chatId, beforeIds, startedAt, signature) {
    for (let attempt = 0; attempt < 24; attempt += 1) {
        const messageData = await findNewOutboundMessage(client, chatId, beforeIds, startedAt, signature);
        if (messageData && (0, SentMessage_1.getSentMessageId)(messageData))
            return messageData;
        await delay(250);
    }
    return null;
}
function instantiateMessage(client, messageData) {
    const whatsapp = require('whatsapp-web.js');
    const MessageCtor = whatsapp.Message;
    if (typeof MessageCtor !== 'function')
        return messageData;
    return new MessageCtor(client, messageData);
}
function installReliableClientSend(client, clientId = 'unknown') {
    if (installedClients.has(client))
        return;
    installedClients.add(client);
    const originalSendMessage = client.sendMessage.bind(client);
    const queues = new Map();
    client.sendMessage = (chatId, content, options = {}) => {
        const previous = queues.get(chatId) ?? Promise.resolve();
        const operation = previous
            .catch(() => undefined)
            .then(async () => {
            const startedAt = Math.floor(Date.now() / 1000);
            const beforeIds = await snapshotOutgoingIds(client, chatId);
            const signature = buildSignature(content, options);
            let result;
            let sendError;
            try {
                result = await originalSendMessage(chatId, content, {
                    ...options,
                    waitUntilMsgSent: true,
                });
            }
            catch (error) {
                sendError = error;
            }
            const directId = (0, SentMessage_1.getSentMessageId)(result);
            if (directId) {
                if (result?.id && typeof result.id === 'object' && !result.id._serialized) {
                    result.id._serialized = directId;
                }
                return result;
            }
            const verifiedData = await verifyOutboundMessage(client, chatId, beforeIds, startedAt, signature);
            if (verifiedData) {
                const recoveredId = (0, SentMessage_1.getSentMessageId)(verifiedData);
                console.warn(`[outbound:${clientId}] WhatsApp returned no message object for ${chatId}; recovered delivery confirmation from chat history${recoveredId ? ` (${recoveredId})` : ''}.`);
                return instantiateMessage(client, verifiedData);
            }
            if (sendError)
                throw sendError;
            throw new Error(`WhatsApp did not create a verifiable outbound message for ${chatId}. The send operation returned no message and no new outgoing message appeared in the chat.`);
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