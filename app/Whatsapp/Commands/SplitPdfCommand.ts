import { Client, Message, MessageMedia } from 'whatsapp-web.js'
import { UserSession } from 'App/Services/SessionManager'
import { promises as fs } from 'fs'
import path from 'path'
import tmp from 'tmp'
import Env from '@ioc:Adonis/Core/Env'
import * as PDFServicesSdk from '@adobe/pdfservices-node-sdk'
import { downloadQuotedMediaSafely } from 'App/Whatsapp/Utils/QuotedMessage'
import { requireSentMessageMetadata } from 'App/Whatsapp/Utils/SentMessage'

export default class SplitPdfCommand {
  public type = 'Command'
  public instructions = '!split <1,3-5> (Responda a un PDF) - Divide el PDF en los rangos especificados.'

  async handle(message: Message, client: Client, _session: UserSession) {
    const body = message.body || ''
    const cmd = body.split(' ')[0].toLowerCase()

    if (cmd !== '!split') return

    const clientId = Env.get('ADOBE_CLIENT_ID')
    const clientSecret = Env.get('ADOBE_CLIENT_SECRET')

    if (!clientId || !clientSecret) {
      await message.reply('Error del sistema: Las credenciales de Adobe PDF no están configuradas.')
      return
    }

    if (!message.hasQuotedMsg) {
      await message.reply('Por favor, cite un archivo PDF.')
      return
    }

    const media = await downloadQuotedMediaSafely(message, 'SplitPdfCommand')
    if (!media) {
      await message.reply(
        'El archivo citado ya no está disponible para descarga. Reenvíe el PDF y vuelva a ejecutar el comando.'
      )
      return
    }

    if (media.mimetype !== 'application/pdf') {
      await message.reply('Formato de archivo no soportado. Por favor, cite un archivo PDF.')
      return
    }

    const pdfMedia: MessageMedia = media

    const credentials = PDFServicesSdk.Credentials.servicePrincipalCredentialsBuilder()
      .withClientId(clientId)
      .withClientSecret(clientSecret)
      .build()
    const executionContext = PDFServicesSdk.ExecutionContext.create(credentials)

    await new Promise<void>((resolve) => {
      tmp.dir({ unsafeCleanup: true }, async (err, dirPath, cleanupCallback) => {
        if (err) {
          await message.reply('Ocurrió un error al preparar el entorno de procesamiento.')
          return resolve()
        }

        try {
          const inputPath = path.join(dirPath, 'input.pdf')
          await fs.writeFile(inputPath, pdfMedia.data, 'base64')

          const splitOperation = PDFServicesSdk.SplitPDF.Operation.createNew()
          const input = PDFServicesSdk.FileRef.createFromLocalFile(inputPath)
          splitOperation.setInput(input)

          const pageRanges = new PDFServicesSdk.PageRanges()
          const inlineText = body.replace(cmd, '').trim()
          const ranges = inlineText.split(",")

          if (ranges.length === 0 || !ranges[0]) {
            await message.reply('Por favor, especifique un rango de páginas válido. Ejemplo: !split 1,3-5')
            return resolve()
          }

          ranges.forEach(range => {
            const [start, end] = range.split('-')
            if (end) {
              pageRanges.addPageRange(parseInt(start, 10), parseInt(end, 10))
            } else {
              pageRanges.addSinglePage(parseInt(start, 10))
            }
          })
          splitOperation.setPageRanges(pageRanges)

          const result = await splitOperation.execute(executionContext)
          let filesPromises: Promise<string>[] = []
          for (let i = 0; i < result.length; i++) {
            const outputPath = path.join(dirPath, `split_${i}.pdf`)
            filesPromises.push(result[i].saveAsFile(outputPath).then(() => outputPath))
          }

          const outputPaths = await Promise.all(filesPromises)

          const destination = message.fromMe ? message.to : message.from
          if (!destination) throw new Error('Unable to determine the destination chat for the split PDF.')

          console.info(`[SplitPdfCommand] PDF processing completed. Sending ${outputPaths.length} output file(s) to ${destination}.`)

          for (let index = 0; index < outputPaths.length; index += 1) {
            const outputPath = outputPaths[index]
            const filename = `split_${index + 1}_of_${outputPaths.length}.pdf`
            const splitPdfMessage = await MessageMedia.fromFilePath(outputPath)
            splitPdfMessage.filename = filename

            const sentMessage = await client.sendMessage(destination, splitPdfMessage, {
              sendMediaAsDocument: true,
              waitUntilMsgSent: true,
              sendSeen: false,
            })
            const metadata = requireSentMessageMetadata(sentMessage, destination)
            console.info(`[SplitPdfCommand] Delivered ${filename} to ${destination} as ${metadata.id}.`)
          }
        } catch (error) {
          console.error('Exception encountered while executing operation', error)
          await message.reply('Ocurrió un error al dividir el archivo PDF. Por favor, intente nuevamente.')
        } finally {
          cleanupCallback()
          resolve()
        }
      })
    })
  }
}