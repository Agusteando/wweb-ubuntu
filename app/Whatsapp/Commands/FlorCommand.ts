import { Client, Message } from 'whatsapp-web.js'
import { UserSession } from 'App/Services/SessionManager'
import puppeteer from 'puppeteer'
import fs from 'fs'
import https from 'https'
import Env from '@ioc:Adonis/Core/Env'

// Le indica al compilador de TypeScript que 'window' existirá en el tiempo de ejecución del navegador
declare const window: any;

export default class FlorCommand {
  public type = 'Command'
  public instructions = '!flor [n] - Obtiene la próxima videoconferencia y grabaciones de Buena Infancia.'

  async handle(message: Message, _client: Client, _session: UserSession) {
    const cmdStr = message.body || ''
    const cmd = cmdStr.split(' ')[0].toLowerCase()

    if (cmd === '!flor') {
      const username = Env.get('BUENAINFANCIA_USERNAME')
      const password = Env.get('BUENAINFANCIA_PASSWORD')

      if (!username || !password) {
        await message.reply('⚠️ *Error de configuración:* Las credenciales de acceso para Buena Infancia no están configuradas en las variables de entorno (.env).')
        return
      }

      const nStr = cmdStr.replace('!flor', '').trim()
      let n = parseInt(nStr, 10)
      if (isNaN(n) || n <= 0) n = 5

      await message.reply('⏳ Extrayendo información de Buena Infancia...')

      // Evita que el servidor crashee si la carpeta no ha sido creada aún
      if (!fs.existsSync('./files')) {
          fs.mkdirSync('./files', { recursive: true })
      }

      let browser;
      try {
        // Lanzamiento adaptado para correr silenciosamente sin fallar en Ubuntu PM2
        browser = await puppeteer.launch({ 
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

        // Uso seguro de variables de entorno
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
            
            video.files = await Promise.all(updatedVideo.files.map(async (file: any) => {
                var fileUrl = `https://strapi.buenainfancia.com.mx${file.url}`;
                var fileName = file.name;
                var fileStream = fs.createWriteStream(`./files/${fileName}`);
                return new Promise((resolve, reject) => {
                    https.get(fileUrl, response => {
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

        var videoconferenciasStringArray = await Promise.all(videoconferencias.map(async (video: any) => {
            var filesString = await Promise.all(video.files.map(async (file: string) => {
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
                var url = {link:file}; 
                return `   ${emoji} - ${url.link} - ${filename}`;
            }));
            return `\n\n*${video.id} ${video.Titulo}*\n\n${filesString.join('\n')}`;
        }));

        var videoconferenciasString = videoconferenciasStringArray.join('');

        // Obtener la fecha de hoy
        const today = new Date();
        const daysToAdd = (today.getDay() === 1) ? 0 : ((8 - today.getDay()) % 7 || 7);
        const nextMonday = new Date(today);
        nextMonday.setDate(today.getDate() + daysToAdd);

        const formattedDate = (nextMonday.getMonth() + 1).toString().padStart(2, '0') + '/' +
        nextMonday.getDate().toString().padStart(2, '0') + '/' +
        nextMonday.getFullYear();

        await message.reply(`Enlace de próxima videoconferencia: ${nextEvent}\nVideoconferencias pasadas:\n${videoconferenciasString}\n\nRecord as Eugenio Álvarez ${formattedDate} at 12:00 pm, Meeting title: Conferencia de Flor ${formattedDate}`);

      } catch (error: any) {
        console.error('An error occurred:', error);
        await message.reply(`❌ Ocurrió un error extrayendo la información.\nError técnico: ${error.message}`);
      } finally {
        if (browser) {
          await browser.close();
        }
      }
    }
  }
}