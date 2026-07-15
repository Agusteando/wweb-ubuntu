import { Client, Message, MessageMedia } from 'whatsapp-web.js'
import { UserSession } from 'App/Services/SessionManager'
import { promises as fs } from 'fs'
import path from 'path'
import tmp from 'tmp'
import { PDFDocument, StandardFonts, rgb, degrees } from 'pdf-lib'
import { downloadQuotedMediaSafely } from 'App/Whatsapp/Utils/QuotedMessage'

export default class StampPdfCommand {
  public type = 'Command'
  public instructions = '!stamp-pdf <número> (Responda a un PDF) - Sella el documento secuencialmente iniciando con el número especificado.'

  async handle(message: Message, _client: Client, _session: UserSession) {
    const body = message.body || ''
    const cmd = body.split(' ')[0].toLowerCase()

    if (cmd !== '!stamp-pdf') return

    if (!message.hasQuotedMsg) {
      await message.reply('Por favor, cite un archivo PDF e indique un número de página inicial.')
      return
    }

    const args = body.replace(cmd, '').trim()
    const startingNumber = parseInt(args, 10)

    if (isNaN(startingNumber)) {
      await message.reply('Por favor, proporcione un número de página inicial válido.')
      return
    }

    const media = await downloadQuotedMediaSafely(message, 'StampPdfCommand')
    if (!media || media.mimetype !== 'application/pdf') {
      await message.reply('Formato de archivo no soportado. Por favor, cite un archivo PDF.')
      return
    }

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
          const pages = pdfDoc.getPages()
          const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold)
          
          let pageNumber = startingNumber

          for (const page of pages) {
            const rotation = page.getRotation().angle % 360
            const { width, height } = page.getSize()
            const text = `${pageNumber}`
            const fontSize = 12
            const textWidth = font.widthOfTextAtSize(text, fontSize)
            const textHeight = font.heightAtSize(fontSize)

            const margin = 10
            let x, y, rotationAngle

            switch (rotation) {
              case 0:
              case 360:
                x = width - textWidth - margin
                y = margin
                rotationAngle = degrees(0)
                break
              case 90:
                x = width - textHeight - margin
                y = height - textWidth - margin
                rotationAngle = degrees(90)
                break
              case 180:
                x = textWidth + margin
                y = height - textHeight - margin
                rotationAngle = degrees(180)
                break
              case 270:
                x = margin
                y = height - textWidth - margin
                rotationAngle = degrees(270)
                break
              default:
                x = width - textWidth - margin
                y = margin
                rotationAngle = degrees(0)
                break
            }

            page.drawText(text, {
              x: x,
              y: y,
              size: fontSize,
              font: font,
              color: rgb(0, 0, 0),
              rotate: rotationAngle,
            })

            pageNumber++
          }

          const modifiedPdfBytes = await pdfDoc.save()
          const outputPath = path.join(dirPath, 'output.pdf')
          await fs.writeFile(outputPath, modifiedPdfBytes)

          const modifiedPdfMessage = await MessageMedia.fromFilePath(outputPath)
          await message.reply(modifiedPdfMessage)

        } catch (error) {
          console.error('Exception encountered while processing the PDF', error)
          await message.reply('Ocurrió un error al sellar el archivo PDF. Por favor, intente nuevamente.')
        } finally {
          cleanupCallback()
          resolve()
        }
      })
    })
  }
}