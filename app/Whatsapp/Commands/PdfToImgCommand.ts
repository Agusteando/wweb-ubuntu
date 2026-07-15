import { Client, Message, MessageMedia } from 'whatsapp-web.js'
import { UserSession } from 'App/Services/SessionManager'
import { promises as fs } from 'fs'
import path from 'path'
import tmp from 'tmp'
import Env from '@ioc:Adonis/Core/Env'
import * as PDFServicesSdk from '@adobe/pdfservices-node-sdk'
import { downloadQuotedMediaSafely } from 'App/Whatsapp/Utils/QuotedMessage'

export default class PdfToImgCommand {
  public type = 'Command'
  public instructions = '!pdf2img [zip] (Responda a un PDF) - Convierte el PDF a imágenes (individuales o archivadas).'

  async handle(message: Message, _client: Client, _session: UserSession) {
    const body = message.body || ''
    const cmd = body.split(' ')[0].toLowerCase()

    if (cmd !== '!pdf2img') return

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

    const media = await downloadQuotedMediaSafely(message, 'PdfToImgCommand')
    if (!media || media.mimetype !== 'application/pdf') {
      await message.reply('Formato de archivo no soportado. Por favor, cite un archivo PDF.')
      return
    }

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
          await fs.writeFile(inputPath, media.data, 'base64')

          let exportPDFToImagesOperation = PDFServicesSdk.ExportPDFToImages.Operation.createNew(
            PDFServicesSdk.ExportPDFToImages.SupportedTargetFormats.JPEG
          )
          const input = PDFServicesSdk.FileRef.createFromLocalFile(inputPath)
          exportPDFToImagesOperation.setInput(input)

          const inlineText = body.replace(cmd, '').trim()
          const isZip = inlineText.toLowerCase() === 'zip'
          
          if (isZip) {
            exportPDFToImagesOperation.setOutputType(PDFServicesSdk.ExportPDFToImages.OutputType.ZIP_OF_PAGE_IMAGES)
          }

          const result = await exportPDFToImagesOperation.execute(executionContext)

          if (isZip) {
            const outputPath = path.join(dirPath, 'export.zip')
            await result[0].saveAsFile(outputPath)

            const zipMessage = await MessageMedia.fromFilePath(outputPath)
            await message.reply(zipMessage)
          } else {
            let filesPromises: Promise<string>[] = []
            for (let i = 0; i < result.length; i++) {
              const outputPath = path.join(dirPath, `export_${i}.jpeg`)
              filesPromises.push(result[i].saveAsFile(outputPath).then(() => outputPath))
            }

            const outputPaths = await Promise.all(filesPromises)

            for (const outputPath of outputPaths) {
              const imageMessage = await MessageMedia.fromFilePath(outputPath)
              await message.reply(imageMessage)
            }
          }
        } catch (error) {
          console.error('Exception encountered while executing operation', error)
          await message.reply('Ocurrió un error al convertir el archivo PDF a imágenes. Por favor, intente nuevamente.')
        } finally {
          cleanupCallback()
          resolve()
        }
      })
    })
  }
}