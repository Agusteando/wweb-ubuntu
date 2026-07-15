"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const promise_1 = __importDefault(require("mysql2/promise"));
const Env_1 = __importDefault(global[Symbol.for('ioc.use')]("Adonis/Core/Env"));
class TicketSystem {
    constructor() {
        this.type = 'Automation';
        this.instructions = 'Sistema automático de tickets (Innovación). Usa !add o !add <numero> para eximir a un usuario.';
    }
    async handle(message, _client, session) {
        const isGroup = message.from.endsWith('@g.us') || message.to.endsWith('@g.us');
        if (isGroup)
            return;
        const body = message.body || '';
        const cmd = body.split(' ')[0].toLowerCase();
        if (message.fromMe && cmd === '!add') {
            const args = body.split(' ');
            let targetId = '';
            if (args.length > 1) {
                targetId = args[1].trim();
                if (!targetId.includes('@')) {
                    targetId += '@c.us';
                }
            }
            else {
                targetId = message.to;
            }
            let addConnection = null;
            try {
                addConnection = await promise_1.default.createConnection({
                    host: Env_1.default.get('DB_HOST') || 'localhost',
                    user: Env_1.default.get('DB_USER') || 'root',
                    password: Env_1.default.get('DB_PASSWORD') || '',
                    database: Env_1.default.get('DB_DATABASE') || 'control_coordinaciones',
                });
                await addConnection.execute('INSERT IGNORE INTO ticket_whitelist (chat_id) VALUES (?)', [targetId]);
                await message.reply(`✅ El usuario ${targetId.replace('@c.us', '')} ha sido añadido a la lista blanca. Ya no recibirá el menú automático.`);
            }
            catch (error) {
                console.error('Error al añadir usuario a la lista blanca:', error);
                await message.reply('❌ Ocurrió un error de conexión al intentar actualizar la lista blanca.');
            }
            finally {
                if (addConnection)
                    await addConnection.end();
            }
            return;
        }
        if (message.fromMe)
            return;
        let isWhitelisted = false;
        let checkConnection = null;
        try {
            checkConnection = await promise_1.default.createConnection({
                host: Env_1.default.get('DB_HOST') || 'localhost',
                user: Env_1.default.get('DB_USER') || 'root',
                password: Env_1.default.get('DB_PASSWORD') || '',
                database: Env_1.default.get('DB_DATABASE') || 'control_coordinaciones',
            });
            const [rows] = await checkConnection.execute('SELECT chat_id FROM ticket_whitelist WHERE chat_id = ? LIMIT 1', [message.from]);
            if (rows.length > 0) {
                isWhitelisted = true;
            }
        }
        catch (error) {
            console.error('Error al consultar lista blanca de tickets:', error);
            return;
        }
        finally {
            if (checkConnection)
                await checkConnection.end();
        }
        if (isWhitelisted)
            return;
        if (!session.ticketState) {
            const menu = `¡Hola, qué tal! Está contactando al área de Innovación.\n\nPara generar su Ticket por favor seleccione la opción correspondiente.\n\n1. Solicitud Nuevo Desarrollo\n2. Problema en plataforma\n3. Sugerencia ó Duda\n4. Más opciones`;
            await message.reply(menu);
            session.ticketState = 'AWAITING_OPTION';
            return;
        }
        if (session.ticketState === 'AWAITING_OPTION') {
            const text = body.trim().toLowerCase();
            const isInfoTrigger = text === '1' || text === '2' || text === '3' ||
                text.includes('mi plan alimenticio') ||
                text.includes('desarrollo externo') ||
                text.includes('contacto directo');
            if (isInfoTrigger) {
                const infoPrompt = `¡Hola! Para procesar su reporte indíqueme por favor:\n\n- Nombre Aplicación o sistema\n- ¿Cómo puede el desarrollador reproducir su problema?\n- Captura de pantalla\n- Descripción de su problema`;
                await message.reply(infoPrompt);
                session.ticketState = 'AWAITING_INFO';
            }
            else if (text === '4') {
                await message.reply(`(En más opciones indica "Mi plan alimenticio" ó "Desarrollo Externo" o "Contacto Directo")`);
            }
            else {
                await message.reply(`Por favor seleccione una opción válida (1, 2, 3 o 4).`);
            }
            return;
        }
        if (session.ticketState === 'AWAITING_INFO') {
            await message.reply(`¡Gracias! Hemos recibido su información. En breve un desarrollador atenderá su solicitud.`);
            session.ticketState = 'FINISHED';
            return;
        }
        if (session.ticketState === 'FINISHED') {
            return;
        }
    }
}
exports.default = TicketSystem;
//# sourceMappingURL=TicketSystem.js.map