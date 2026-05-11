import { Client, Message, MessageMedia } from 'whatsapp-web.js'
import { UserSession } from 'App/Services/SessionManager'
import { promises as fs } from 'fs'
import path from 'path'
import tmp from 'tmp'
import { PDFDocument } from 'pdf-lib'

export default class ImgToPdfCommand {
  public type = 'Command'
  public instructions = '!img2pdf (Responda a una imagen) - Convierte la imagen proporcionada a formato PDF.'

  async handle(message: Message, _client: Client, _session: UserSession) {
    const body = message.body || ''
    const cmd = body.split(' ')[0].toLowerCase()

    if (cmd !== '!img2pdf') return

    if (!message.hasQuotedMsg) {
      await message.reply('Por favor, cite un archivo de imagen.')
      return
    }

    const quotedMsg = await message.getQuotedMessage()
    if (!quotedMsg.hasMedia) {
      await message.reply('Por favor, cite un archivo de imagen.')
      return
    }

    const media = await quotedMsg.downloadMedia()
    if (!media || !media.mimetype.startsWith('image/')) {
      await message.reply('Formato de archivo no soportado. Por favor, cite una imagen válida.')
      return
    }

    await new Promise<void>((resolve) => {
      tmp.dir({ unsafeCleanup: true }, async (err, dirPath, cleanupCallback) => {
        if (err) {
          await message.reply('Ocurrió un error al preparar el entorno de procesamiento.')
          return resolve()
        }

        try {
          const inputPath = path.join(dirPath, 'input_image')
          await fs.writeFile(inputPath, media.data, 'base64')

          const pdfDoc = await PDFDocument.create()
          let image
          const imgBytes = await fs.readFile(inputPath)

          if (media.mimetype === 'image/png') {
            image = await pdfDoc.embedPng(imgBytes)
          } else {
            image = await pdfDoc.embedJpg(imgBytes)
          }

          const page = pdfDoc.addPage([595.28, 841.89]) // Tamaño estándar A4

          const scaleX = 595.28 / image.width
          const scaleY = 841.89 / image.height
          const scale = Math.min(scaleX, scaleY)

          const imgWidth = image.width * scale
          const imgHeight = image.height * scale

          const x = (595.28 - imgWidth) / 2
          const y = (841.89 - imgHeight) / 2

          page.drawImage(image, {
            x: x,
            y: y,
            width: imgWidth,
            height: imgHeight
          })

          const pdfBytes = await pdfDoc.save()
          const outputPath = path.join(dirPath, 'output.pdf')
          await fs.writeFile(outputPath, pdfBytes)

          const pdfMessage = await MessageMedia.fromFilePath(outputPath)
          await message.reply(pdfMessage)

        } catch (error) {
          console.error('Error during PDF creation:', error)
          await message.reply('Ocurrió un error inesperado al convertir la imagen a PDF. Por favor, intente nuevamente.')
        } finally {
          cleanupCallback()
          resolve()
        }
      })
    })
  }
}