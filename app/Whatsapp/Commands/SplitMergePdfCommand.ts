import { Client, Message, MessageMedia } from 'whatsapp-web.js'
import { UserSession } from 'App/Services/SessionManager'
import { promises as fs } from 'fs'
import path from 'path'
import tmp from 'tmp'
import { PDFDocument } from 'pdf-lib'
import { downloadQuotedMediaSafely } from 'App/Whatsapp/Utils/QuotedMessage'

export default class SplitMergePdfCommand {
  public type = 'Command'
  public instructions = '!split-merge <1-2,4> (Responda a un PDF) - Extrae y combina las páginas especificadas.'

  async handle(message: Message, _client: Client, _session: UserSession) {
    const body = message.body || ''
    const cmd = body.split(' ')[0].toLowerCase()

    if (cmd !== '!split-merge') return

    if (!message.hasQuotedMsg) {
      await message.reply('Por favor, cite un archivo PDF.')
      return
    }

    const media = await downloadQuotedMediaSafely(message, 'SplitMergePdfCommand')
    if (!media || media.mimetype !== 'application/pdf') {
      await message.reply('Formato de archivo no soportado. Por favor, cite un archivo PDF.')
      return
    }

    const inlineText = body.replace(cmd, '').trim()
    if (!inlineText) {
      await message.reply('Por favor, especifique un rango de páginas válido. Ejemplo: !split-merge 1,3-5')
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

          const splitPdf = async (pdfDoc: PDFDocument, rangesToExtract: number[][]) => {
            const splitParts: PDFDocument[] = []
            for (const range of rangesToExtract) {
              const splitPartDoc = await PDFDocument.create()
              const validRange = range.filter(i => i >= 0 && i < pdfDoc.getPageCount())
              if (validRange.length === 0) continue

              const pages = await splitPartDoc.copyPages(pdfDoc, validRange)
              pages.forEach(page => splitPartDoc.addPage(page))
              splitParts.push(splitPartDoc)
            }
            return splitParts
          }

          const combinePdfs = async (pdfDocs: PDFDocument[]) => {
            const combinedDoc = await PDFDocument.create()
            for (const pdfDoc of pdfDocs) {
              const pages = await combinedDoc.copyPages(pdfDoc, pdfDoc.getPageIndices())
              pages.forEach(page => combinedDoc.addPage(page))
            }
            return combinedDoc
          }

          const ranges = inlineText.split(',').map(range => {
            const [startStr, endStr] = range.split('-')
            const start = Number(startStr)
            const end = endStr ? Number(endStr) : undefined
            
            if (end) {
              return Array.from({ length: end - start + 1 }, (_, i) => start - 1 + i)
            } else {
              return [start - 1]
            }
          })

          const originalPdfDoc = await PDFDocument.load(await fs.readFile(inputPath))
          const splitDocs = await splitPdf(originalPdfDoc, ranges)

          if (splitDocs.length === 0) {
            await message.reply('El rango especificado no coincide con las páginas del documento original.')
            return resolve()
          }

          const combinedDoc = await combinePdfs(splitDocs)
          const combinedPdfBytes = await combinedDoc.save()

          const outputPath = path.join(dirPath, 'output.pdf')
          await fs.writeFile(outputPath, combinedPdfBytes)

          const combinedPdfMessage = await MessageMedia.fromFilePath(outputPath)
          await message.reply(combinedPdfMessage)

        } catch (error) {
          console.error('Exception encountered while executing operation', error)
          await message.reply('Ocurrió un error al dividir y combinar el archivo PDF. Por favor, intente nuevamente.')
        } finally {
          cleanupCallback()
          resolve()
        }
      })
    })
  }
}