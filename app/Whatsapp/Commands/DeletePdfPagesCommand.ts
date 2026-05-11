import { Client, Message, MessageMedia } from 'whatsapp-web.js'
import { UserSession } from 'App/Services/SessionManager'
import { promises as fs } from 'fs'
import path from 'path'
import tmp from 'tmp'
import { PDFDocument } from 'pdf-lib'

export default class DeletePdfPagesCommand {
  public type = 'Command'
  public instructions = '!delete <rangos> (Responda a un PDF) - Elimina las páginas especificadas.'

  async handle(message: Message, _client: Client, _session: UserSession) {
    const body = message.body || ''
    const cmd = body.split(' ')[0].toLowerCase()

    if (cmd !== '!delete') return

    if (!message.hasQuotedMsg) {
      await message.reply('Por favor, cite un archivo PDF.')
      return
    }

    const quotedMsg = await message.getQuotedMessage()
    if (!quotedMsg.hasMedia) {
      await message.reply('Por favor, cite un archivo PDF.')
      return
    }

    const media = await quotedMsg.downloadMedia()
    if (!media || media.mimetype !== 'application/pdf') {
      await message.reply('Formato de archivo no soportado. Por favor, cite un archivo PDF.')
      return
    }

    const inlineText = body.replace(cmd, '').trim()
    if (!inlineText) {
      await message.reply('Por favor, especifique un rango de páginas válido. Ejemplo: !delete 1,3-5')
      return
    }

    await message.reply('Iniciando la eliminación de páginas... esto puede tardar un momento...')

    await new Promise<void>((resolve) => {
      tmp.dir({ unsafeCleanup: true }, async (err, dirPath, cleanupCallback) => {
        if (err) {
          await message.reply('Ocurrió un error al preparar el entorno de procesamiento.')
          return resolve()
        }

        try {
          const inputPath = path.join(dirPath, 'input.pdf')
          await fs.writeFile(inputPath, media.data, 'base64')

          const pdfBytes = await fs.readFile(inputPath)
          const pdfDoc = await PDFDocument.load(pdfBytes)
          const originalTotalPages = pdfDoc.getPageCount()

          const pagesToDelete = new Set<number>()
          const ranges = inlineText.split(',')
          
          for (const range of ranges) {
            const [startStr, endStr] = range.split('-')
            const start = parseInt(startStr, 10)
            const end = endStr ? parseInt(endStr, 10) : start
            
            if (!isNaN(start) && !isNaN(end)) {
              for (let i = start; i <= end; i++) {
                pagesToDelete.add(i - 1)
              }
            }
          }

          const pagesToDeleteDesc = Array.from(pagesToDelete).sort((a, b) => b - a)
          let deletedPagesCount = 0

          for (const pageNum of pagesToDeleteDesc) {
            if (pageNum >= 0 && pageNum < originalTotalPages) {
              pdfDoc.removePage(pageNum)
              deletedPagesCount++
            }
          }

          if (deletedPagesCount === 0) {
            await message.reply('No se eliminó ninguna página. Asegúrese de que los rangos indicados existan en el documento.')
            return resolve()
          }

          const newTotalPages = pdfDoc.getPageCount()
          const newPdfBytes = await pdfDoc.save()
          const outputPath = path.join(dirPath, 'output.pdf')
          await fs.writeFile(outputPath, newPdfBytes)

          const newPdfMessage = await MessageMedia.fromFilePath(outputPath)
          await message.reply(newPdfMessage)
          await message.reply(`Se han eliminado ${deletedPagesCount} páginas. El documento ahora tiene ${newTotalPages} páginas (originalmente ${originalTotalPages} páginas).`)

        } catch (error) {
          console.error('Exception encountered while executing operation', error)
          await message.reply('Ocurrió un error al eliminar las páginas del archivo PDF. Por favor, intente nuevamente.')
        } finally {
          cleanupCallback()
          resolve()
        }
      })
    })
  }
}