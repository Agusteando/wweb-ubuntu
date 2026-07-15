"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const puppeteer_1 = __importDefault(require("puppeteer"));
const fs_1 = __importDefault(require("fs"));
const https_1 = __importDefault(require("https"));
const Env_1 = __importDefault(global[Symbol.for('ioc.use')]("Adonis/Core/Env"));
class FlorCommand {
    constructor() {
        this.type = 'Command';
        this.instructions = '!flor [n] - Obtiene la próxima videoconferencia y grabaciones de Buena Infancia.';
    }
    async handle(message, _client, _session) {
        const cmdStr = message.body || '';
        const cmd = cmdStr.split(' ')[0].toLowerCase();
        if (cmd === '!flor') {
            const username = Env_1.default.get('BUENAINFANCIA_USERNAME');
            const password = Env_1.default.get('BUENAINFANCIA_PASSWORD');
            if (!username || !password) {
                await message.reply('⚠️ *Error de configuración:* Las credenciales de acceso para Buena Infancia no están configuradas en las variables de entorno (.env).');
                return;
            }
            const nStr = cmdStr.replace('!flor', '').trim();
            let n = parseInt(nStr, 10);
            if (isNaN(n) || n <= 0)
                n = 5;
            await message.reply('⏳ Extrayendo información de Buena Infancia...');
            if (!fs_1.default.existsSync('./files')) {
                fs_1.default.mkdirSync('./files', { recursive: true });
            }
            let browser;
            try {
                browser = await puppeteer_1.default.launch({
                    headless: true,
                    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
                });
                var page = await browser.newPage();
                await page.goto('https://buenainfancia.com.mx/login');
                var usernameSelector = '#__layout > div > div.container-login > div > div.font-body > div > div.form-slot.z-10 > div > div > div.form-container.text-morado.w-full > div:nth-child(2) > input';
                var passwordSelector = '#__layout > div > div.container-login > div > div.font-body > div > div.form-slot.z-10 > div > div > div.form-container.text-morado.w-full > div.form-input.relative > input[type=password]';
                var submitButtonSelector = '#__layout > div > div.container-login > div > div.font-body > div > div.form-slot.z-10 > div > div > div.form-container.text-morado.w-full > div.text-center > button';
                await page.waitForSelector(usernameSelector);
                await page.waitForSelector(passwordSelector);
                await page.waitForSelector(submitButtonSelector);
                await page.type(usernameSelector, username);
                await page.type(passwordSelector, password);
                await Promise.all([
                    page.waitForNavigation(),
                    page.click(submitButtonSelector),
                ]);
                await page.goto('https://buenainfancia.com.mx/videoconferencias');
                var videoconferencias = await page.evaluate(() => window.__NUXT__.data[0].videoconferencias);
                var nextEvent = await page.evaluate(() => window.__NUXT__.data[0].nextEvent.zoom);
                videoconferencias = videoconferencias.reverse().slice(0, n);
                for (var video of videoconferencias) {
                    await page.goto(`https://buenainfancia.com.mx/videoconferencias/${video.id}`);
                    var updatedVideo = await page.evaluate(() => window.__NUXT__.data[0].videoconferencia);
                    video.files = await Promise.all(updatedVideo.files.map(async (file) => {
                        var fileUrl = `https://strapi.buenainfancia.com.mx${file.url}`;
                        var fileName = file.name;
                        var fileStream = fs_1.default.createWriteStream(`./files/${fileName}`);
                        return new Promise((resolve, reject) => {
                            https_1.default.get(fileUrl, response => {
                                response.pipe(fileStream);
                                fileStream.on('finish', () => {
                                    fileStream.close();
                                    resolve(`https://wweb.casitaapps.com/files/${fileName}`);
                                });
                                fileStream.on('error', reject);
                            });
                        });
                    }));
                    video.vimeo = updatedVideo.vimeo;
                }
                var videoconferenciasStringArray = await Promise.all(videoconferencias.map(async (video) => {
                    var filesString = await Promise.all(video.files.map(async (file) => {
                        var fileType = file.split('.').pop();
                        let emoji;
                        switch (fileType) {
                            case 'pdf':
                                emoji = '◼️';
                                break;
                            case 'xlsx':
                                emoji = '◻️';
                                break;
                            default:
                                emoji = '📎';
                        }
                        var filename = file.split("/")[file.split("/").length - 1];
                        var url = { link: file };
                        return `   ${emoji} - ${url.link} - ${filename}`;
                    }));
                    return `\n\n*${video.id} ${video.Titulo}*\n\n${filesString.join('\n')}`;
                }));
                var videoconferenciasString = videoconferenciasStringArray.join('');
                const today = new Date();
                const daysToAdd = (today.getDay() === 1) ? 0 : ((8 - today.getDay()) % 7 || 7);
                const nextMonday = new Date(today);
                nextMonday.setDate(today.getDate() + daysToAdd);
                const formattedDate = (nextMonday.getMonth() + 1).toString().padStart(2, '0') + '/' +
                    nextMonday.getDate().toString().padStart(2, '0') + '/' +
                    nextMonday.getFullYear();
                await message.reply(`Enlace de próxima videoconferencia: ${nextEvent}\nVideoconferencias pasadas:\n${videoconferenciasString}\n\nRecord as Eugenio Álvarez ${formattedDate} at 12:00 pm, Meeting title: Conferencia de Flor ${formattedDate}`);
            }
            catch (error) {
                console.error('An error occurred:', error);
                await message.reply(`❌ Ocurrió un error extrayendo la información.\nError técnico: ${error.message}`);
            }
            finally {
                if (browser) {
                    await browser.close();
                }
            }
        }
    }
}
exports.default = FlorCommand;
//# sourceMappingURL=FlorCommand.js.map