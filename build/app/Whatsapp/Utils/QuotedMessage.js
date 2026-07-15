"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.downloadMessageMediaSafely = exports.downloadQuotedMediaSafely = exports.getQuotedMessageSafely = exports.buildQuotedMessageIdCandidates = void 0;
const whatsapp_web_js_1 = require("whatsapp-web.js");
function asRecord(value) {
    return value && typeof value === 'object' ? value : null;
}
function asSerialized(value) {
    if (typeof value === 'string' && value.trim())
        return value.trim();
    const record = asRecord(value);
    if (!record)
        return undefined;
    const candidate = record._serialized ?? record.$1;
    return typeof candidate === 'string' && candidate.trim() ? candidate.trim() : undefined;
}
function asString(value) {
    if (typeof value === 'string' && value.trim())
        return value.trim();
    const record = asRecord(value);
    if (!record)
        return undefined;
    for (const key of ['_serialized', '$1', 'id', 'stanzaId', 'stanzaID']) {
        const candidate = record[key];
        if (typeof candidate === 'string' && candidate.trim())
            return candidate.trim();
    }
    return undefined;
}
function addUnique(target, value) {
    const text = asString(value);
    if (text && !target.includes(text))
        target.push(text);
}
function addSerialized(target, value) {
    const text = asSerialized(value) ?? asString(value);
    if (text && text.includes('_') && text.includes('@') && !target.includes(text))
        target.push(text);
}
function collectKnownReferences(raw, message) {
    const serializedIds = [];
    const stanzaIds = [];
    const remoteIds = [];
    const participantIds = [];
    const quoted = asRecord(raw.quotedMsg) ?? asRecord(raw.quotedMessage);
    const context = asRecord(raw.contextInfo) ??
        asRecord(raw.msgContextInfo) ??
        asRecord(quoted?.contextInfo) ??
        asRecord(quoted?.msgContextInfo);
    const quotedId = asRecord(quoted?.id);
    for (const value of [
        quoted?.id,
        quoted?._serialized,
        quoted?.$1,
        raw.quotedMsgId,
        raw.quotedMessageId,
        context?.quotedMsgId,
        context?.quotedMessageId,
    ]) {
        addSerialized(serializedIds, value);
    }
    for (const value of [
        quotedId?.id,
        quoted?.stanzaId,
        quoted?.stanzaID,
        raw.quotedStanzaID,
        raw.quotedStanzaId,
        raw.stanzaId,
        raw.stanzaID,
        context?.stanzaId,
        context?.stanzaID,
        context?.quotedStanzaID,
        context?.quotedStanzaId,
    ]) {
        addUnique(stanzaIds, value);
    }
    const messageId = asRecord(message.id);
    for (const value of [
        quotedId?.remote,
        quoted?.remote,
        quoted?.remoteJid,
        raw.quotedRemoteJid,
        context?.remoteJid,
        context?.remote,
        messageId?.remote,
        raw.id?.remote,
        message.fromMe ? message.to : message.from,
    ]) {
        addUnique(remoteIds, value);
    }
    for (const value of [
        quotedId?.participant,
        quoted?.participant,
        quoted?.author,
        raw.quotedParticipant,
        context?.participant,
        context?.quotedParticipant,
    ]) {
        addUnique(participantIds, value);
    }
    return { serializedIds, stanzaIds, remoteIds, participantIds };
}
function buildQuotedMessageIdCandidates(message) {
    const raw = asRecord(message._data) ?? {};
    const references = collectKnownReferences(raw, message);
    const candidates = [...references.serializedIds];
    for (const stanzaId of references.stanzaIds) {
        if (stanzaId.includes('_') && stanzaId.includes('@')) {
            if (!candidates.includes(stanzaId))
                candidates.push(stanzaId);
            continue;
        }
        for (const remoteId of references.remoteIds) {
            for (const fromMe of [false, true]) {
                const directId = `${fromMe}_${remoteId}_${stanzaId}`;
                if (!candidates.includes(directId))
                    candidates.push(directId);
                for (const participantId of references.participantIds) {
                    const groupId = `${directId}_${participantId}`;
                    if (!candidates.includes(groupId))
                        candidates.push(groupId);
                }
            }
        }
    }
    return candidates;
}
exports.buildQuotedMessageIdCandidates = buildQuotedMessageIdCandidates;
function buildCurrentMessageIdCandidates(message) {
    const candidates = [];
    const id = asRecord(message.id);
    addSerialized(candidates, id);
    const remote = asString(id?.remote) ?? (message.fromMe ? message.to : message.from);
    const stanza = asString(id?.id);
    const participant = asString(id?.participant);
    if (remote && stanza) {
        const base = `${Boolean(id?.fromMe)}_${remote}_${stanza}`;
        if (!candidates.includes(base))
            candidates.push(base);
        if (participant) {
            const group = `${base}_${participant}`;
            if (!candidates.includes(group))
                candidates.push(group);
        }
    }
    return candidates;
}
async function resolveInBrowser(message, mode, includeMedia) {
    const client = message.client;
    const page = client?.pupPage;
    if (!page?.evaluate)
        return { status: 'not_found' };
    const raw = asRecord(message._data) ?? {};
    const references = collectKnownReferences(raw, message);
    const input = {
        mode,
        includeMedia,
        currentIds: buildCurrentMessageIdCandidates(message),
        quotedIds: buildQuotedMessageIdCandidates(message),
        stanzaIds: references.stanzaIds,
        remoteIds: references.remoteIds,
        participantIds: references.participantIds,
    };
    try {
        return await page.evaluate(async (resolverInput) => {
            const w = globalThis;
            const safeRequire = (name) => {
                try {
                    return w.require(name);
                }
                catch (_error) {
                    return undefined;
                }
            };
            const serialized = (value) => {
                if (!value)
                    return undefined;
                if (typeof value === 'string')
                    return value;
                return value._serialized ?? value.$1;
            };
            const uniquePush = (target, value) => {
                const text = serialized(value) ?? (typeof value === 'string' ? value : undefined);
                if (text && !target.includes(text))
                    target.push(text);
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
            const collections = safeRequire('WAWebCollections');
            const messages = collections?.Msg;
            if (!messages)
                return { status: 'not_found' };
            const getById = async (id) => {
                if (!id)
                    return null;
                try {
                    const local = messages.get(id);
                    if (local)
                        return local;
                }
                catch (_error) { }
                try {
                    return (await messages.getMessagesById([id]))?.messages?.[0] ?? null;
                }
                catch (_error) {
                    return null;
                }
            };
            const modelData = (model) => {
                if (!model)
                    return null;
                try {
                    const data = model.serialize ? model.serialize() : model;
                    if (!data || typeof data !== 'object')
                        return null;
                    data.isEphemeral = model.isEphemeral ?? data.isEphemeral;
                    data.isStatusV3 = model.isStatusV3 ?? data.isStatusV3;
                    if (typeof data.id?.remote === 'object')
                        data.id.remote = serialized(data.id.remote);
                    return normalize(data);
                }
                catch (_error) {
                    return null;
                }
            };
            const allModels = () => {
                try {
                    return messages.getModelsArray?.() ?? [];
                }
                catch (_error) {
                    return [];
                }
            };
            const matchesKnownReference = (model, stanzaIds, remoteIds, participantIds) => {
                const id = model?.id;
                const stanza = serialized(id?.id) ?? id?.id;
                if (!stanza || !stanzaIds.includes(String(stanza)))
                    return false;
                const remote = serialized(id?.remote) ?? id?.remote;
                if (remoteIds.length && remote && !remoteIds.includes(String(remote)))
                    return false;
                const participant = serialized(id?.participant) ?? id?.participant;
                if (participantIds.length && participant && !participantIds.includes(String(participant)))
                    return false;
                return true;
            };
            let currentModel = null;
            for (const id of resolverInput.currentIds) {
                currentModel = await getById(id);
                if (currentModel)
                    break;
            }
            if (!currentModel && resolverInput.currentIds?.length) {
                const currentStanzas = resolverInput.currentIds
                    .map((id) => id.split('_')[2])
                    .filter(Boolean);
                const models = allModels();
                for (let index = models.length - 1; index >= 0; index -= 1) {
                    const candidate = models[index];
                    const candidateStanza = serialized(candidate?.id?.id) ?? candidate?.id?.id;
                    if (candidateStanza && currentStanzas.includes(String(candidateStanza))) {
                        currentModel = candidate;
                        break;
                    }
                }
            }
            let targetModel = resolverInput.mode === 'current' ? currentModel : null;
            if (resolverInput.mode === 'quoted') {
                for (const id of resolverInput.quotedIds) {
                    targetModel = await getById(id);
                    if (targetModel)
                        break;
                }
                if (!targetModel && currentModel) {
                    for (const candidate of [
                        currentModel.quotedMsg,
                        currentModel.quotedMessage,
                        currentModel.quotedMsgObj,
                    ]) {
                        if (candidate?.serialize || candidate?.id) {
                            const candidateId = serialized(candidate?.id);
                            targetModel = candidateId ? await getById(candidateId) : candidate;
                            if (targetModel)
                                break;
                        }
                    }
                }
                const stanzaIds = [...(resolverInput.stanzaIds ?? [])];
                const remoteIds = [...(resolverInput.remoteIds ?? [])];
                const participantIds = [...(resolverInput.participantIds ?? [])];
                if (currentModel) {
                    const currentData = modelData(currentModel);
                    const contexts = [
                        currentData?.quotedMsg,
                        currentData?.quotedMessage,
                        currentData?.contextInfo,
                        currentData?.msgContextInfo,
                        currentModel.quotedMsg,
                        currentModel.msgContextInfo,
                    ];
                    for (const context of contexts) {
                        if (!context || typeof context !== 'object')
                            continue;
                        uniquePush(stanzaIds, context.stanzaId);
                        uniquePush(stanzaIds, context.stanzaID);
                        uniquePush(stanzaIds, context.id?.id);
                        uniquePush(remoteIds, context.remoteJid);
                        uniquePush(remoteIds, context.remote);
                        uniquePush(remoteIds, context.id?.remote);
                        uniquePush(participantIds, context.participant);
                        uniquePush(participantIds, context.author);
                        uniquePush(participantIds, context.id?.participant);
                    }
                }
                if (!targetModel && stanzaIds.length) {
                    const models = allModels();
                    for (let index = models.length - 1; index >= 0; index -= 1) {
                        const candidate = models[index];
                        if (matchesKnownReference(candidate, stanzaIds, remoteIds, participantIds)) {
                            targetModel = candidate;
                            break;
                        }
                    }
                }
                if (!targetModel && currentModel) {
                    try {
                        const chatId = serialized(currentModel.id?.remote) ?? currentModel.id?.remote;
                        const chatWidFactory = safeRequire('WAWebWidFactory');
                        const chatWid = chatId && chatWidFactory?.createWid ? chatWidFactory.createWid(chatId) : chatId;
                        const chat = collections.Chat?.get(chatWid);
                        const chatModels = chat?.msgs?.getModelsArray?.() ?? [];
                        for (let index = chatModels.length - 1; index >= 0; index -= 1) {
                            const candidate = chatModels[index];
                            if (matchesKnownReference(candidate, stanzaIds, remoteIds, participantIds)) {
                                targetModel = candidate;
                                break;
                            }
                        }
                    }
                    catch (_error) { }
                }
            }
            if (!targetModel)
                return { status: 'not_found' };
            const messageData = modelData(targetModel);
            if (!resolverInput.includeMedia) {
                return messageData ? { status: 'ok', messageData } : { status: 'not_found' };
            }
            const hasMedia = Boolean(targetModel.directPath ||
                targetModel.mediaData ||
                targetModel.mediaObject ||
                messageData?.directPath);
            if (!hasMedia)
                return { status: 'no_media', messageData };
            try {
                await targetModel.downloadMedia?.({
                    downloadEvenIfExpensive: true,
                    rmrReason: 1,
                    isUserInitiated: true,
                });
            }
            catch (_error) {
            }
            let blob;
            try {
                const cacheModule = safeRequire('WAWebMediaInMemoryBlobCache');
                const cache = cacheModule?.InMemoryMediaBlobCache ?? cacheModule;
                blob = cache?.get?.(targetModel.mediaObject?.filehash ?? targetModel.filehash);
                if (blob?.forceToBlob)
                    blob = blob.forceToBlob();
            }
            catch (_error) {
                blob = undefined;
            }
            if (!blob && targetModel.mediaObject?.mediaBlob?.forceToBlob) {
                try {
                    blob = targetModel.mediaObject.mediaBlob.forceToBlob();
                }
                catch (_error) {
                    blob = undefined;
                }
            }
            const toBase64 = async (input) => {
                if (!input)
                    return null;
                let mediaBlob;
                if (input instanceof w.Blob) {
                    mediaBlob = input;
                }
                else if (input instanceof ArrayBuffer) {
                    mediaBlob = new w.Blob([input]);
                }
                else if (ArrayBuffer.isView(input)) {
                    mediaBlob = new w.Blob([input.buffer]);
                }
                else if (typeof input.arrayBuffer === 'function') {
                    mediaBlob = new w.Blob([await input.arrayBuffer()]);
                }
                else {
                    return null;
                }
                return await new Promise((resolve) => {
                    const reader = new w.FileReader();
                    reader.onload = () => {
                        const result = typeof reader.result === 'string' ? reader.result : '';
                        resolve(result.includes(',') ? result.slice(result.indexOf(',') + 1) : null);
                    };
                    reader.onerror = () => resolve(null);
                    reader.readAsDataURL(mediaBlob);
                });
            };
            let data = await toBase64(blob);
            if (!data) {
                try {
                    const managerModule = safeRequire('WAWebDownloadManager') ?? safeRequire('WADownloadManager');
                    const manager = managerModule?.downloadManager ??
                        managerModule?.DownloadManager ??
                        managerModule;
                    const download = manager?.downloadAndMaybeDecrypt;
                    if (typeof download === 'function') {
                        const mockQpl = {
                            addAnnotations() {
                                return this;
                            },
                            addPoint() {
                                return this;
                            },
                        };
                        const mediaData = targetModel.mediaData ?? {};
                        const decrypted = await download.call(manager, {
                            directPath: targetModel.directPath ?? mediaData.directPath,
                            encFilehash: targetModel.encFilehash ?? mediaData.encFilehash,
                            filehash: targetModel.filehash ?? mediaData.filehash,
                            mediaKey: targetModel.mediaKey ?? mediaData.mediaKey,
                            mediaKeyTimestamp: targetModel.mediaKeyTimestamp ?? mediaData.mediaKeyTimestamp,
                            type: targetModel.type ?? mediaData.type,
                            signal: new AbortController().signal,
                            downloadQpl: mockQpl,
                        });
                        data = await toBase64(decrypted);
                    }
                }
                catch (_error) {
                    data = null;
                }
            }
            if (!data)
                return { status: 'media_unavailable', messageData };
            return {
                status: 'ok',
                messageData,
                media: {
                    data,
                    mimetype: targetModel.mimetype ??
                        targetModel.mediaData?.mimetype ??
                        messageData?.mimetype ??
                        'application/octet-stream',
                    filename: targetModel.filename ?? targetModel.mediaData?.filename ?? messageData?.filename,
                    filesize: targetModel.size ?? targetModel.mediaData?.size ?? messageData?.size,
                },
            };
        }, input);
    }
    catch (_error) {
        return { status: 'not_found' };
    }
}
async function getQuotedMessageSafely(message, _context) {
    if (!message.hasQuotedMsg)
        return null;
    const resolution = await resolveInBrowser(message, 'quoted', false);
    if (resolution.status !== 'ok' || !resolution.messageData)
        return null;
    const client = message.client;
    return new (message.constructor)(client, resolution.messageData);
}
exports.getQuotedMessageSafely = getQuotedMessageSafely;
async function downloadQuotedMediaSafely(message, _context) {
    if (!message.hasQuotedMsg)
        return null;
    const resolution = await resolveInBrowser(message, 'quoted', true);
    if (resolution.status !== 'ok' || !resolution.media)
        return null;
    return new whatsapp_web_js_1.MessageMedia(resolution.media.mimetype, resolution.media.data, resolution.media.filename, resolution.media.filesize);
}
exports.downloadQuotedMediaSafely = downloadQuotedMediaSafely;
async function downloadMessageMediaSafely(message, _context) {
    if (!message.hasMedia)
        return null;
    const resolution = await resolveInBrowser(message, 'current', true);
    if (resolution.status !== 'ok' || !resolution.media)
        return null;
    return new whatsapp_web_js_1.MessageMedia(resolution.media.mimetype, resolution.media.data, resolution.media.filename, resolution.media.filesize);
}
exports.downloadMessageMediaSafely = downloadMessageMediaSafely;
//# sourceMappingURL=QuotedMessage.js.map