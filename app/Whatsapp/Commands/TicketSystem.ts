import { Client, Message } from 'whatsapp-web.js'
import { UserSession } from 'App/Services/SessionManager'
import mysql from 'mysql2/promise'
import Env from '@ioc:Adonis/Core/Env'

export default class TicketSystem {
  public type = 'Automation'
  public instructions = 'Sistema automático de tickets (Innovación). Usa !add o !add <numero> para eximir a un usuario.'

  async handle(message: Message, _client: Client, session: UserSession) {
    // La automatización no debe ejecutarse dentro de grupos de WhatsApp
    const isGroup = message.from.endsWith('@g.us') || message.to.endsWith('@g.us')
    if (isGroup) return

    const body = message.body || ''
    const cmd = body.split(' ')[0].toLowerCase()

    // ---------------------------------------------------------
    // Funcionalidad !add - Intervención del Agente/Desarrollador
    // ---------------------------------------------------------
    if (message.fromMe && cmd === '!add') {
      const args = body.split(' ')
      let targetId = ''

      if (args.length > 1) {
        // Soporta indicar el número directamente, ej: !add 5217920165569
        targetId = args[1].trim()
        if (!targetId.includes('@')) {
          targetId += '@c.us'
        }
      } else {
        // Si no se indica número, extrae directamente del chat abierto
        targetId = message.to
      }

      let addConnection: mysql.Connection | null = null
      try {
        addConnection = await mysql.createConnection({
          host: Env.get('DB_HOST') || 'localhost',
          user: Env.get('DB_USER') || 'root',
          password: Env.get('DB_PASSWORD') || '',
          database: Env.get('DB_DATABASE') || 'control_coordinaciones',
        })

        await addConnection.execute(
          'INSERT IGNORE INTO ticket_whitelist (chat_id) VALUES (?)',
          [targetId]
        )
        
        await message.reply(`✅ El usuario ${targetId.replace('@c.us', '')} ha sido añadido a la lista blanca. Ya no recibirá el menú automático.`)
      } catch (error: any) {
        console.error('Error al añadir usuario a la lista blanca:', error)
        await message.reply('❌ Ocurrió un error de conexión al intentar actualizar la lista blanca.')
      } finally {
        if (addConnection) await addConnection.end()
      }
      return
    }

    // A partir de aquí ignoramos los mensajes salientes para que el bot no se active a sí mismo
    if (message.fromMe) return

    // ---------------------------------------------------------
    // Validación de la Lista Blanca
    // ---------------------------------------------------------
    let isWhitelisted = false
    let checkConnection: mysql.Connection | null = null

    try {
      checkConnection = await mysql.createConnection({
        host: Env.get('DB_HOST') || 'localhost',
        user: Env.get('DB_USER') || 'root',
        password: Env.get('DB_PASSWORD') || '',
        database: Env.get('DB_DATABASE') || 'control_coordinaciones',
      })

      const [rows] = await checkConnection.execute<any[]>(
        'SELECT chat_id FROM ticket_whitelist WHERE chat_id = ? LIMIT 1',
        [message.from]
      )
      
      if (rows.length > 0) {
        isWhitelisted = true
      }
    } catch (error: any) {
      console.error('Error al consultar lista blanca de tickets:', error)
      // En caso de caída de base de datos detenemos la ejecución para evitar respuestas de spam accidentales
      return
    } finally {
      if (checkConnection) await checkConnection.end()
    }

    // Si el usuario está exento (Whitelist), simplemente retornamos permitiendo un flujo normal
    if (isWhitelisted) return

    // ---------------------------------------------------------
    // Máquina de Estados del Sistema de Tickets
    // ---------------------------------------------------------
    
    // ESTADO 0: Nuevo usuario, presentar menú principal
    if (!session.ticketState) {
      const menu = `¡Hola, qué tal! Está contactando al área de Innovación.\n\nPara generar su Ticket por favor seleccione la opción correspondiente.\n\n1. Solicitud Nuevo Desarrollo\n2. Problema en plataforma\n3. Sugerencia ó Duda\n4. Más opciones`
      
      await message.reply(menu)
      session.ticketState = 'AWAITING_OPTION'
      return
    }

    // ESTADO 1: Esperando que el usuario seleccione una opción
    if (session.ticketState === 'AWAITING_OPTION') {
      const text = body.trim().toLowerCase()
      
      const isInfoTrigger = 
        text === '1' || text === '2' || text === '3' || 
        text.includes('mi plan alimenticio') || 
        text.includes('desarrollo externo') || 
        text.includes('contacto directo')

      if (isInfoTrigger) {
        const infoPrompt = `¡Hola! Para procesar su reporte indíqueme por favor:\n\n- Nombre Aplicación o sistema\n- ¿Cómo puede el desarrollador reproducir su problema?\n- Captura de pantalla\n- Descripción de su problema`
        await message.reply(infoPrompt)
        session.ticketState = 'AWAITING_INFO'
      } else if (text === '4') {
        await message.reply(`(En más opciones indica "Mi plan alimenticio" ó "Desarrollo Externo" o "Contacto Directo")`)
      } else {
        await message.reply(`Por favor seleccione una opción válida (1, 2, 3 o 4).`)
      }
      return
    }

    // ESTADO 2: Recopilación de información del reporte (Texto o Imágenes)
    if (session.ticketState === 'AWAITING_INFO') {
      await message.reply(`¡Gracias! Hemos recibido su información. En breve un desarrollador atenderá su solicitud.`)
      session.ticketState = 'FINISHED'
      return
    }

    // ESTADO 3: Proceso Terminado (En Silencio)
    if (session.ticketState === 'FINISHED') {
      // El usuario completó el ciclo. El bot permanecerá en silencio.
      // Un humano u agente externo puede atender el chat sin que el bot interfiera.
      // Si el agente desea eximirlo permanentemente para el futuro, enviará el comando !add
      return
    }
  }
}