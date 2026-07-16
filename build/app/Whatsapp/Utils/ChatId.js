"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveMessageDestination = exports.resolveCanonicalChatId = exports.normalizeWhatsAppChatId = void 0;
const resolvedIds = new WeakMap();
const pendingResolutions = new WeakMap();
function asRecord(value) {
    return value && typeof value === "object" ? value : null;
}
function serialized(value) {
    if (typeof value === "string" && value.trim())
        return value.trim();
    const record = asRecord(value);
    if (!record)
        return undefined;
    for (const key of ["_serialized", "$1", "pn", "phone", "phoneNumber", "id"]) {
        const candidate = record[key];
        if (typeof candidate === "string" && candidate.trim())
            return candidate.trim();
        const nested = asRecord(candidate);
        const nestedValue = nested?._serialized ?? nested?.$1;
        if (typeof nestedValue === "string" && nestedValue.trim())
            return nestedValue.trim();
    }
    return undefined;
}
function normalizeWhatsAppChatId(chatId) {
    const value = String(chatId || "").trim();
    if (value.endsWith("@s.whatsapp.net")) {
        return `${value.slice(0, -"@s.whatsapp.net".length)}@c.us`;
    }
    return value;
}
exports.normalizeWhatsAppChatId = normalizeWhatsAppChatId;
function isPhoneJid(chatId) {
    return chatId.endsWith("@c.us") || chatId.endsWith("@s.whatsapp.net");
}
function phoneJidFrom(value) {
    const candidate = serialized(value);
    if (!candidate)
        return undefined;
    const normalized = normalizeWhatsAppChatId(candidate);
    return isPhoneJid(normalized) ? normalized : undefined;
}
async function resolveWithClientApi(client, lid) {
    const getContactLidAndPhone = client.getContactLidAndPhone;
    if (typeof getContactLidAndPhone !== "function")
        return undefined;
    try {
        const result = await getContactLidAndPhone.call(client, [lid]);
        const entry = Array.isArray(result) ? result[0] : result;
        return phoneJidFrom(entry?.pn ?? entry?.phone ?? entry?.phoneNumber ?? entry);
    }
    catch (_error) {
        return undefined;
    }
}
async function resolveInBrowser(client, lid) {
    const page = client.pupPage;
    if (!page?.evaluate)
        return undefined;
    try {
        const result = await page.evaluate(async (targetLid) => {
            const w = globalThis;
            const readSerialized = (value) => {
                if (!value)
                    return undefined;
                if (typeof value === "string")
                    return value;
                return value._serialized ?? value.$1;
            };
            try {
                const pair = await w.WWebJS?.enforceLidAndPnRetrieval?.(targetLid);
                const phone = readSerialized(pair?.phone ?? pair?.pn);
                if (phone)
                    return phone;
            }
            catch (_error) { }
            try {
                const wid = w.require("WAWebWidFactory").createWid(targetLid);
                const collections = w.require("WAWebCollections");
                const contact = collections.Contact?.get?.(wid) ??
                    collections.Contact?.get?.(targetLid) ??
                    (await collections.Contact?.find?.(wid));
                return readSerialized(contact?.phoneNumber ??
                    contact?.phone ??
                    contact?.pn ??
                    contact?.id?.phoneNumber);
            }
            catch (_error) {
                return undefined;
            }
        }, lid);
        return phoneJidFrom(result);
    }
    catch (_error) {
        return undefined;
    }
}
async function performResolution(client, requestedChatId) {
    const normalized = normalizeWhatsAppChatId(requestedChatId);
    if (!normalized.endsWith("@lid"))
        return normalized;
    const phoneJid = (await resolveWithClientApi(client, normalized)) ??
        (await resolveInBrowser(client, normalized));
    if (!phoneJid) {
        console.warn(`[jid] No phone-number mapping was available for ${normalized}; retaining the LID destination.`);
        return normalized;
    }
    console.info(`[jid] Resolved ${normalized} to canonical phone JID ${phoneJid}.`);
    return phoneJid;
}
async function resolveCanonicalChatId(client, chatId) {
    const normalized = normalizeWhatsAppChatId(chatId);
    if (!normalized)
        throw new Error("Cannot resolve an empty WhatsApp chat ID.");
    if (!normalized.endsWith("@lid"))
        return normalized;
    let cache = resolvedIds.get(client);
    if (!cache) {
        cache = new Map();
        resolvedIds.set(client, cache);
    }
    const cached = cache.get(normalized);
    if (cached)
        return cached;
    let pending = pendingResolutions.get(client);
    if (!pending) {
        pending = new Map();
        pendingResolutions.set(client, pending);
    }
    const existing = pending.get(normalized);
    if (existing)
        return existing;
    const resolution = performResolution(client, normalized)
        .then((resolved) => {
        if (resolved !== normalized)
            cache.set(normalized, resolved);
        return resolved;
    })
        .finally(() => {
        pending.delete(normalized);
    });
    pending.set(normalized, resolution);
    return resolution;
}
exports.resolveCanonicalChatId = resolveCanonicalChatId;
async function resolveMessageDestination(message, client) {
    const destination = message.fromMe ? message.to : message.from;
    if (!destination)
        throw new Error("Unable to determine the WhatsApp destination for this message.");
    return resolveCanonicalChatId(client, destination);
}
exports.resolveMessageDestination = resolveMessageDestination;
//# sourceMappingURL=ChatId.js.map