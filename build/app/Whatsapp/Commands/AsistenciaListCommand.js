"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const whatsapp_web_js_1 = require("whatsapp-web.js");
const Utils_1 = global[Symbol.for('ioc.use')]("App/Services/Utils");
const promise_1 = __importDefault(require("mysql2/promise"));
const axios_1 = __importDefault(require("axios"));
const Env_1 = __importDefault(global[Symbol.for('ioc.use')]("Adonis/Core/Env"));
const VALID_PLANTELES = ['PM', 'PT', 'SM', 'ST', 'CT', 'CM', 'ISSSTE TOLUCA', 'ISSSTE METEPEC'];
const MAIN_ATTENDANCE_PLANTELES = new Set(['PM', 'PT', 'SM', 'ST']);
const EXCLUDED_TARGET_KEYS = new Set(['CT', 'CM', 'CO', 'DM']);
const CONTACTS_ENDPOINT = 'https://sipae.casitaapps.com/api/directory/contacts';
const DEFAULT_REPORT_ENDPOINT = 'https://bot.casitaapps.com/attendance-by-grade';
class AsistenciaListCommand {
    constructor() {
        this.type = 'Command';
        this.instructions = '!asistencia-list <plantel> - Consulta la asistencia y genera el reporte consolidado de inasistencias.';
    }
    normalizePlantel(input) {
        const normalized = input.replace(/\s+/g, ' ').trim().toUpperCase();
        const aliases = {
            PREEM: 'CM',
            'PREES MET': 'CM',
            'PREES METEPEC': 'CM',
            PREET: 'CT',
            'PREES TOL': 'CT',
            'PREES TOLUCA': 'CT',
            ISSSTE: 'ISSSTE TOLUCA',
            'ISSSTE TOL': 'ISSSTE TOLUCA',
            'ISSSTE MET': 'ISSSTE METEPEC',
        };
        const candidate = aliases[normalized] || normalized;
        return VALID_PLANTELES.includes(candidate) ? candidate : null;
    }
    parsePlantel(body) {
        const payload = body.replace(/^\s*!asistencia-list\b/i, '').trim();
        if (!payload)
            return null;
        return this.normalizePlantel(payload);
    }
    getTargetKey(plantel) {
        if (plantel === 'ISSSTE TOLUCA')
            return 'CT';
        if (plantel === 'ISSSTE METEPEC')
            return 'CM';
        return plantel;
    }
    normalizePhone(value) {
        if (!value)
            return null;
        let phone = value.replace(/@c\.us/gi, '').replace(/\D/g, '');
        if (phone.startsWith('521') && phone.length === 13)
            phone = phone.substring(3);
        else if (phone.startsWith('52') && phone.length === 12)
            phone = phone.substring(2);
        else if (phone.length > 10)
            phone = phone.slice(-10);
        return phone.length === 10 ? phone : null;
    }
    getDirectoryKey(area, contact) {
        const apiToInternal = {
            PREEM: 'CM',
            PREET: 'CT',
            'PREES MET': 'CM',
            'PREES TOL': 'CT',
        };
        const rawKey = String(contact.plantel || contact.area || contact.nombre || area?.plantel || area?.nombre || area?.name || '').trim().toUpperCase();
        if (!rawKey)
            return null;
        return apiToInternal[rawKey] || rawKey;
    }
    async getMentionsMap() {
        try {
            const resp = await axios_1.default.get(CONTACTS_ENDPOINT, { timeout: 15000 });
            const data = Array.isArray(resp.data) ? resp.data : [];
            const mentionsMap = {};
            for (const area of data) {
                const contacts = Array.isArray(area?.contactos)
                    ? area.contactos
                    : Array.isArray(area?.contacts)
                        ? area.contacts
                        : [];
                for (const contact of contacts) {
                    const phone = this.normalizePhone(contact.telefono || contact.phone || contact.celular);
                    if (!phone)
                        continue;
                    const key = this.getDirectoryKey(area, contact);
                    if (!key)
                        continue;
                    if (!mentionsMap[key])
                        mentionsMap[key] = new Set();
                    mentionsMap[key].add(phone);
                }
            }
            return Object.fromEntries(Object.entries(mentionsMap).map(([key, phones]) => [key, Array.from(phones)]));
        }
        catch (err) {
            console.error('Failed to resolve dynamic mentions map from SIPAE:', err?.message || err);
            return {};
        }
    }
    async resolveWhatsappIds(client, phones) {
        const ids = [];
        for (const phone of phones) {
            const candidates = [`521${phone}`, `52${phone}`];
            let resolved = null;
            for (const candidate of candidates) {
                try {
                    const wid = await client.getNumberId(candidate);
                    const serialized = wid?._serialized || wid?.serialized || null;
                    if (serialized) {
                        resolved = serialized;
                        break;
                    }
                }
                catch (e) {
                }
            }
            ids.push(resolved || `521${phone}@c.us`);
        }
        return Array.from(new Set(ids));
    }
    buildMentionText(contactIds) {
        return contactIds
            .map((id) => id.replace(/@c\.us$/i, '').replace(/@s\.whatsapp\.net$/i, ''))
            .map((phone) => `@${phone}`)
            .join(' ');
    }
    async getAttendanceReportMedia(plantel) {
        const baseEndpoint = Env_1.default.get('ATTENDANCE_REPORT_ENDPOINT') || DEFAULT_REPORT_ENDPOINT;
        const endpoint = `${baseEndpoint}?plantel=${encodeURIComponent(plantel)}`;
        const mediaData = await (0, Utils_1.getBase64FromEndpoint)(endpoint);
        if (!mediaData || mediaData.length === 0 || !mediaData[0].data)
            return null;
        return new whatsapp_web_js_1.MessageMedia(mediaData[0].mimetype || 'image/png', mediaData[0].data);
    }
    async handle(message, client, _session) {
        const body = message.body || '';
        const cmd = body.trim().split(/\s+/)[0]?.toLowerCase();
        if (cmd !== '!asistencia-list')
            return;
        const plantel = this.parsePlantel(body);
        if (!plantel) {
            await message.reply(`Plantel inválido o ausente. Uso: \`!asistencia-list PM\`. Opciones válidas: ${VALID_PLANTELES.join(', ')}.`);
            return;
        }
        let connection = null;
        try {
            connection = await promise_1.default.createConnection({
                host: Env_1.default.get('DB_HOST') || 'localhost',
                user: Env_1.default.get('DB_USER') || 'root',
                password: Env_1.default.get('DB_PASSWORD') || '',
                database: Env_1.default.get('DB_DATABASE') || 'control_coordinaciones',
            });
            const queryCount = `
        SELECT
          CONCAT(grado, ' ', grupo) AS grado_grupo,
          COUNT(*) AS asistencia,
          SUM(IF(attendance = 1, 1, 0)) AS presenciales,
          SUM(IF(attendance = 0, 1, 0)) AS ausencias
        FROM asistencia
        WHERE DATE(fecha) = CURDATE()
          AND plantel = ?
        GROUP BY grado, grupo
        ORDER BY grado, grupo;
      `;
            const [rows] = await connection.execute(queryCount, [plantel]);
            const totalAttendance = rows.reduce((sum, row) => sum + Number(row.asistencia || 0), 0);
            const queryAbsences = `
        SELECT grado, grupo, GROUP_CONCAT(CONCAT('- ', name) SEPARATOR ',\n') AS names
        FROM asistencia
        WHERE plantel = ? AND DATE(fecha) = CURDATE() AND attendance = '0'
        GROUP BY grado, grupo
        ORDER BY grado, grupo;
      `;
            const [results] = await connection.execute(queryAbsences, [plantel]);
            if (results.length === 0) {
                await message.reply('¡Gracias por registrar la asistencia de hoy! No hay alumnos ausentes reportados.');
                return;
            }
            const targetKey = this.getTargetKey(plantel);
            if (EXCLUDED_TARGET_KEYS.has(targetKey)) {
                await message.reply('Este plantel está excluido de la automatización de la lista de asistencia principal.');
                return;
            }
            const mentionsMap = await this.getMentionsMap();
            const contactPhones = mentionsMap[targetKey] || [];
            if (contactPhones.length === 0) {
                await message.reply('No se encontraron directivos registrados para este plantel en el directorio SIPAE.');
                return;
            }
            const contactIds = await this.resolveWhatsappIds(client, contactPhones);
            const mentionsString = this.buildMentionText(contactIds);
            const link = `https://admin.casitaiedis.edu.mx/ausentes/${encodeURIComponent(plantel)}`;
            const chatId = MAIN_ATTENDANCE_PLANTELES.has(plantel)
                ? '5217224748923-1440559046@g.us'
                : '5217221530884-1423926397@g.us';
            let extraText = '';
            const formattedText = `📊 *Resumen de asistencia total:* ${totalAttendance}\n\n` +
                `Estimado equipo, agradecemos su apoyo para completar el registro de asistencia del día de hoy. A continuación se detalla la lista de alumnos ausentes.\n\n` +
                `🔗 *Registro de motivos de inasistencia:*\n` +
                `${link}\n\n`;
            results.forEach((row) => {
                extraText += `*${row.grado}° ${row.grupo}:*\n${row.names}\n\n`;
            });
            let reportMedia = null;
            try {
                reportMedia = await this.getAttendanceReportMedia(plantel);
            }
            catch (e) {
                console.error(`Chart generation endpoint timeout/error for ${plantel}:`, e?.message || e);
            }
            if (reportMedia) {
                await client.sendMessage(chatId, reportMedia, {
                    mentions: contactIds,
                    caption: `${mentionsString}\n\n${formattedText}`,
                    waitUntilMsgSent: true,
                });
                for (const contactId of contactIds) {
                    await client.sendMessage(contactId, reportMedia, {
                        caption: formattedText + extraText,
                        waitUntilMsgSent: true,
                    });
                }
            }
            else {
                await client.sendMessage(chatId, `${mentionsString}\n\n${formattedText}`, {
                    mentions: contactIds,
                    waitUntilMsgSent: true,
                });
                for (const contactId of contactIds) {
                    await client.sendMessage(contactId, formattedText + extraText, { waitUntilMsgSent: true });
                }
            }
        }
        catch (error) {
            console.error('An unexpected error occurred during assistance extraction:', error);
            await message.reply('Ocurrió un error técnico al procesar el reporte de inasistencias.');
        }
        finally {
            if (connection)
                await connection.end();
        }
    }
}
exports.default = AsistenciaListCommand;
//# sourceMappingURL=AsistenciaListCommand.js.map