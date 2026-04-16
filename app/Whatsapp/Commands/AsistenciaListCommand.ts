import { Client, Message, MessageMedia } from 'whatsapp-web.js'
import { UserSession } from 'App/Services/SessionManager'
import { getBase64FromEndpoint } from 'App/Services/Utils'
import mysql from 'mysql2/promise'
import axios from 'axios'
import Env from '@ioc:Adonis/Core/Env'

export default class AsistenciaListCommand {
  public type = 'Command'
  public instructions = '!asistencia-list <plantel> - Consulta la asistencia y genera el reporte consolidado de inasistencias.'

  private async getMentionsMap(): Promise<Record<string, string[]>> {
    try {
      const resp = await axios.get('https://sipae.casitaapps.com/api/directory/contacts');
      const data = resp.data;
      const newMap: Record<string, string[]> = {};
      
      const apiToInternal: Record<string, string> = {
        'PREEM': 'CM',
        'PREET': 'CT'
      };

      for (const area of data) {
        if (!area.contactos) continue;
        for (const c of area.contactos) {
          if (!c.telefono) continue;
          
          const internalName = apiToInternal[c.nombre] || c.nombre;
          let phone = c.telefono.replace(/@c\.us/gi, '').replace(/\D/g, '');

          // Standardize to 10 MX digits for precise injection tagging
          if (phone.startsWith('521') && phone.length === 13) {
            phone = phone.substring(3);
          } else if (phone.startsWith('52') && phone.length === 12) {
            phone = phone.substring(2);
          } else if (phone.length > 10) {
            phone = phone.slice(-10);
          }

          if (!newMap[internalName]) {
            newMap[internalName] = [];
          }
          newMap[internalName].push(phone);
        }
      }
      return newMap;
    } catch (err: any) {
      console.error('Failed to resolve dynamic mentions map from SIPAE:', err.message);
      return {};
    }
  }

  async handle(message: Message, client: Client, _session: UserSession) {
    const body = message.body || '';
    const cmd = body.split(' ')[0].toLowerCase();

    if (cmd === '!asistencia-list') {
      const inlineText = body.replace(/!asistencia-list/i, '').trim().toUpperCase();

      if (!inlineText) {
        await message.reply('Por favor, indique el plantel. Ejemplo: `!asistencia-list PM`');
        return;
      }

      const validLabels = ['PM', 'PT', 'SM', 'ST', 'CT', 'CM', 'ISSSTE TOLUCA', 'ISSSTE METEPEC'];
      const plantel = inlineText;

      if (!validLabels.includes(plantel)) {
        await message.reply(`El plantel indicado es inválido. Las opciones válidas son: ${validLabels.join(', ')}.`);
        return;
      }

      let connection: mysql.Connection | null = null;

      try {
        // Securely mount connections strictly via Env scope
        connection = await mysql.createConnection({
          host: Env.get('DB_HOST') || 'localhost',
          user: Env.get('DB_USER') || 'root',
          password: Env.get('DB_PASSWORD') || '',
          database: Env.get('DB_DATABASE') || 'control_coordinaciones',
        });

        // Query 1: Calculate global metrics
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
        const [rows] = await connection.execute<any[]>(queryCount, [plantel]);
        const totalAttendance = rows.reduce((sum: number, row: any) => sum + row.asistencia, 0);

        // Query 2: Extrapolate precise absence list natively avoiding loops
        const queryAbsences = `
          SELECT grado, grupo, GROUP_CONCAT(CONCAT('- ', name) SEPARATOR ',\n') AS names
          FROM asistencia 
          WHERE plantel = ? AND DATE(fecha) = CURDATE() AND attendance = '0'
          GROUP BY grado, grupo 
          ORDER BY grado, grupo;
        `;
        const [results] = await connection.execute<any[]>(queryAbsences, [plantel]);

        if (results.length === 0) {
          await message.reply("¡Gracias por registrar la asistencia de hoy! No hay alumnos ausentes reportados.");
          return;
        }

        // Logic mappings for internal system vs API identifiers
        const targetKey = plantel === 'ISSSTE TOLUCA' ? 'CT' : (plantel === 'ISSSTE METEPEC' ? 'CM' : plantel);

        const ignoreGroups = new Set(['CT', 'CM', 'CO', 'DM']);
        if (ignoreGroups.has(targetKey)) {
          await message.reply("Este plantel está excluido de la automatización de la lista de asistencia principal.");
          return;
        }

        const mentionsMap = await this.getMentionsMap();
        const contacts = mentionsMap[targetKey] || [];

        if (contacts.length === 0) {
          await message.reply("No se encontraron directivos registrados para este plantel en el directorio SIPAE.");
          return;
        }

        // Ensure strict mobile prefix format needed by whatsapp-web.js
        const contactIds = contacts.map(c => `521${c}@c.us`);
        const mentionsString = contactIds.map(id => `@${id.replace('@c.us', '')}`).join(' ');

        const link = `https://admin.casitaiedis.edu.mx/ausentes/${encodeURIComponent(plantel)}`;
        const chatId = ['PM', 'PT', 'SM', 'ST'].includes(plantel) 
          ? '5217224748923-1440559046@g.us' 
          : '5217221530884-1423926397@g.us';

        let extraText = '';
        let formattedText = `📊 *Resumen de asistencia total:* ${totalAttendance}\n\n` +
          `Estimado equipo, agradecemos su apoyo para completar el registro de asistencia del día de hoy. A continuación se detalla la lista de alumnos ausentes.\n\n` +
          `🔗 *Registro de motivos de inasistencia:*\n` +
          `${link}\n\n`;

        results.forEach((row: any) => {
          extraText += `*${row.grado}° ${row.grupo}:*\n${row.names}\n\n`;
        });

        const endpoint = `https://bot.casitaapps.com/attendance-by-grade?plantel=${encodeURIComponent(plantel)}`;
        let mediaData: any[] = [];
        try {
          mediaData = await getBase64FromEndpoint(endpoint);
        } catch (e: any) {
          console.error(`Chart generation endpoint timeout/error for ${plantel}:`, e.message);
        }

        if (mediaData && mediaData.length > 0) {
          const msg = new MessageMedia(mediaData[0].mimetype, mediaData[0].data);

          // Phase A: Distribute into target group chat tagging responsible individuals
          await client.sendMessage(chatId, msg, {
            mentions: contactIds,
            caption: mentionsString + '\n\n' + formattedText
          });

          // Phase B: Push verbose private DM to principals independently
          for (const cId of contactIds) {
            await client.sendMessage(cId, msg, {
              caption: formattedText + extraText
            });
          }
        } else {
          // Graceful fallback avoiding crashes if the chart microservice dies
          await client.sendMessage(chatId, mentionsString + '\n\n' + formattedText, {
            mentions: contactIds
          });

          for (const cId of contactIds) {
            await client.sendMessage(cId, formattedText + extraText);
          }
        }

      } catch (error: any) {
        console.error('An unexpected error occurred during assistance extraction:', error);
        await message.reply("Ocurrió un error técnico al procesar el reporte de inasistencias.");
      } finally {
        if (connection) await connection.end();
      }
    }
  }
}