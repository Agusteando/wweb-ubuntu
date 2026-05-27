import { Client, Message, MessageMedia } from 'whatsapp-web.js'
import { UserSession } from 'App/Services/SessionManager'
import { getBase64FromEndpoint } from 'App/Services/Utils'
import mysql from 'mysql2/promise'
import axios from 'axios'
import Env from '@ioc:Adonis/Core/Env'

const VALID_PLANTELES = ['PM', 'PT', 'SM', 'ST', 'CT', 'CM', 'ISSSTE TOLUCA', 'ISSSTE METEPEC'] as const
const MAIN_ATTENDANCE_PLANTELES = new Set(['PM', 'PT', 'SM', 'ST'])
const EXCLUDED_TARGET_KEYS = new Set(['CT', 'CM', 'CO', 'DM'])
const CONTACTS_ENDPOINT = 'https://sipae.casitaapps.com/api/directory/contacts'
const DEFAULT_REPORT_ENDPOINT = 'https://bot.casitaapps.com/attendance-by-grade'

type Plantel = typeof VALID_PLANTELES[number]

type DirectoryContact = {
  nombre?: string
  area?: string
  plantel?: string
  telefono?: string
  phone?: string
  celular?: string
  Role?: string
  rol?: string
}

export default class AsistenciaListCommand {
  public type = 'Command'
  public instructions = '!asistencia-list <plantel> - Consulta la asistencia y genera el reporte consolidado de inasistencias.'

  private normalizePlantel(input: string): Plantel | null {
    const normalized = input.replace(/\s+/g, ' ').trim().toUpperCase()
    const aliases: Record<string, Plantel> = {
      PREEM: 'CM',
      'PREES MET': 'CM',
      'PREES METEPEC': 'CM',
      PREET: 'CT',
      'PREES TOL': 'CT',
      'PREES TOLUCA': 'CT',
      ISSSTE: 'ISSSTE TOLUCA',
      'ISSSTE TOL': 'ISSSTE TOLUCA',
      'ISSSTE MET': 'ISSSTE METEPEC',
    }

    const candidate = aliases[normalized] || normalized
    return (VALID_PLANTELES as readonly string[]).includes(candidate) ? candidate as Plantel : null
  }

  private parsePlantel(body: string): Plantel | null {
    const payload = body.replace(/^\s*!asistencia-list\b/i, '').trim()
    if (!payload) return null
    return this.normalizePlantel(payload)
  }

  private getTargetKey(plantel: Plantel): string {
    if (plantel === 'ISSSTE TOLUCA') return 'CT'
    if (plantel === 'ISSSTE METEPEC') return 'CM'
    return plantel
  }

  private normalizePhone(value?: string): string | null {
    if (!value) return null

    let phone = value.replace(/@c\.us/gi, '').replace(/\D/g, '')
    if (phone.startsWith('521') && phone.length === 13) phone = phone.substring(3)
    else if (phone.startsWith('52') && phone.length === 12) phone = phone.substring(2)
    else if (phone.length > 10) phone = phone.slice(-10)

    return phone.length === 10 ? phone : null
  }

  private getDirectoryKey(area: any, contact: DirectoryContact): string | null {
    const apiToInternal: Record<string, string> = {
      PREEM: 'CM',
      PREET: 'CT',
      'PREES MET': 'CM',
      'PREES TOL': 'CT',
    }

    const rawKey = String(contact.plantel || contact.area || contact.nombre || area?.plantel || area?.nombre || area?.name || '').trim().toUpperCase()
    if (!rawKey) return null
    return apiToInternal[rawKey] || rawKey
  }

  private async getMentionsMap(): Promise<Record<string, string[]>> {
    try {
      const resp = await axios.get(CONTACTS_ENDPOINT, { timeout: 15000 })
      const data = Array.isArray(resp.data) ? resp.data : []
      const mentionsMap: Record<string, Set<string>> = {}

      for (const area of data) {
        const contacts = Array.isArray(area?.contactos)
          ? area.contactos
          : Array.isArray(area?.contacts)
            ? area.contacts
            : []

        for (const contact of contacts as DirectoryContact[]) {
          const phone = this.normalizePhone(contact.telefono || contact.phone || contact.celular)
          if (!phone) continue

          const key = this.getDirectoryKey(area, contact)
          if (!key) continue

          if (!mentionsMap[key]) mentionsMap[key] = new Set<string>()
          mentionsMap[key].add(phone)
        }
      }

      return Object.fromEntries(
        Object.entries(mentionsMap).map(([key, phones]) => [key, Array.from(phones)])
      )
    } catch (err: any) {
      console.error('Failed to resolve dynamic mentions map from SIPAE:', err?.message || err)
      return {}
    }
  }

  private async resolveWhatsappIds(client: Client, phones: string[]): Promise<string[]> {
    const ids: string[] = []

    for (const phone of phones) {
      const candidates = [`521${phone}`, `52${phone}`]
      let resolved: string | null = null

      for (const candidate of candidates) {
        try {
          const wid = await client.getNumberId(candidate)
          const serialized = wid?._serialized || (wid as any)?.serialized || null
          if (serialized) {
            resolved = serialized
            break
          }
        } catch (e) {
          // Keep trying the legacy MX mobile prefix fallback below.
        }
      }

      ids.push(resolved || `521${phone}@c.us`)
    }

    return Array.from(new Set(ids))
  }

  private buildMentionText(contactIds: string[]): string {
    return contactIds
      .map((id) => id.replace(/@c\.us$/i, '').replace(/@s\.whatsapp\.net$/i, ''))
      .map((phone) => `@${phone}`)
      .join(' ')
  }

  private async getAttendanceReportMedia(plantel: Plantel): Promise<MessageMedia | null> {
    const baseEndpoint = Env.get('ATTENDANCE_REPORT_ENDPOINT') || DEFAULT_REPORT_ENDPOINT
    const endpoint = `${baseEndpoint}?plantel=${encodeURIComponent(plantel)}`
    const mediaData = await getBase64FromEndpoint(endpoint)

    if (!mediaData || mediaData.length === 0 || !mediaData[0].data) return null
    return new MessageMedia(mediaData[0].mimetype || 'image/png', mediaData[0].data)
  }

  async handle(message: Message, client: Client, _session: UserSession) {
    const body = message.body || ''
    const cmd = body.trim().split(/\s+/)[0]?.toLowerCase()

    if (cmd !== '!asistencia-list') return

    const plantel = this.parsePlantel(body)
    if (!plantel) {
      await message.reply(`Plantel inválido o ausente. Uso: \`!asistencia-list PM\`. Opciones válidas: ${VALID_PLANTELES.join(', ')}.`)
      return
    }

    let connection: mysql.Connection | null = null

    try {
      connection = await mysql.createConnection({
        host: Env.get('DB_HOST') || 'localhost',
        user: Env.get('DB_USER') || 'root',
        password: Env.get('DB_PASSWORD') || '',
        database: Env.get('DB_DATABASE') || 'control_coordinaciones',
      })

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
      `
      const [rows] = await connection.execute<any[]>(queryCount, [plantel])
      const totalAttendance = rows.reduce((sum: number, row: any) => sum + Number(row.asistencia || 0), 0)

      const queryAbsences = `
        SELECT grado, grupo, GROUP_CONCAT(CONCAT('- ', name) SEPARATOR ',\n') AS names
        FROM asistencia
        WHERE plantel = ? AND DATE(fecha) = CURDATE() AND attendance = '0'
        GROUP BY grado, grupo
        ORDER BY grado, grupo;
      `
      const [results] = await connection.execute<any[]>(queryAbsences, [plantel])

      if (results.length === 0) {
        await message.reply('¡Gracias por registrar la asistencia de hoy! No hay alumnos ausentes reportados.')
        return
      }

      const targetKey = this.getTargetKey(plantel)
      if (EXCLUDED_TARGET_KEYS.has(targetKey)) {
        await message.reply('Este plantel está excluido de la automatización de la lista de asistencia principal.')
        return
      }

      const mentionsMap = await this.getMentionsMap()
      const contactPhones = mentionsMap[targetKey] || []

      if (contactPhones.length === 0) {
        await message.reply('No se encontraron directivos registrados para este plantel en el directorio SIPAE.')
        return
      }

      const contactIds = await this.resolveWhatsappIds(client, contactPhones)
      const mentionsString = this.buildMentionText(contactIds)

      const link = `https://admin.casitaiedis.edu.mx/ausentes/${encodeURIComponent(plantel)}`
      const chatId = MAIN_ATTENDANCE_PLANTELES.has(plantel)
        ? '5217224748923-1440559046@g.us'
        : '5217221530884-1423926397@g.us'

      let extraText = ''
      const formattedText = `📊 *Resumen de asistencia total:* ${totalAttendance}\n\n` +
        `Estimado equipo, agradecemos su apoyo para completar el registro de asistencia del día de hoy. A continuación se detalla la lista de alumnos ausentes.\n\n` +
        `🔗 *Registro de motivos de inasistencia:*\n` +
        `${link}\n\n`

      results.forEach((row: any) => {
        extraText += `*${row.grado}° ${row.grupo}:*\n${row.names}\n\n`
      })

      let reportMedia: MessageMedia | null = null
      try {
        reportMedia = await this.getAttendanceReportMedia(plantel)
      } catch (e: any) {
        console.error(`Chart generation endpoint timeout/error for ${plantel}:`, e?.message || e)
      }

      if (reportMedia) {
        await client.sendMessage(chatId, reportMedia, {
          mentions: contactIds,
          caption: `${mentionsString}\n\n${formattedText}`,
          waitUntilMsgSent: true,
        })

        for (const contactId of contactIds) {
          await client.sendMessage(contactId, reportMedia, {
            caption: formattedText + extraText,
            waitUntilMsgSent: true,
          })
        }
      } else {
        await client.sendMessage(chatId, `${mentionsString}\n\n${formattedText}`, {
          mentions: contactIds,
          waitUntilMsgSent: true,
        })

        for (const contactId of contactIds) {
          await client.sendMessage(contactId, formattedText + extraText, { waitUntilMsgSent: true })
        }
      }
    } catch (error: any) {
      console.error('An unexpected error occurred during assistance extraction:', error)
      await message.reply('Ocurrió un error técnico al procesar el reporte de inasistencias.')
    } finally {
      if (connection) await connection.end()
    }
  }
}
