import { google } from 'googleapis'
import { promises as fs } from 'fs'
import path from 'path'
import Env from '@ioc:Adonis/Core/Env'
import Application from '@ioc:Adonis/Core/Application'
import axios from 'axios'
import * as PDFServicesSdk from '@adobe/pdfservices-node-sdk'
import tmp from 'tmp'

export async function getGoogleAdminAuth(scopes: string[]) {
  const credPath = Env.get('GOOGLE_CREDENTIALS_PATH')
  
  if (!credPath) {
    throw new Error('Missing environment variable: GOOGLE_CREDENTIALS_PATH is required to use Google API features.')
  }

  const absolutePath = path.isAbsolute(credPath)
    ? credPath
    : path.resolve(Application.appRoot, credPath)

  let content: string
  try {
    content = await fs.readFile(absolutePath, 'utf8')
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      throw new Error(`Google credentials file not found at: ${absolutePath}. Please ensure the file exists or update your .env paths.`)
    }
    throw error
  }

  const auth = JSON.parse(content)
  
  const client = new google.auth.JWT({
    email: auth.client_email,
    key: auth.private_key,
    scopes: scopes,
    subject: Env.get('G_SUITE_ADMIN_EMAIL', 'desarrollo.tecnologico@casitaiedis.edu.mx')
  })
  
  await client.authorize()
  return client
}

function getAdobeContext() {
  const clientId = Env.get('ADOBE_CLIENT_ID')
  const clientSecret = Env.get('ADOBE_CLIENT_SECRET')
  
  if (!clientId || !clientSecret) return null

  const credentials = PDFServicesSdk.Credentials.servicePrincipalCredentialsBuilder()
    .withClientId(clientId)
    .withClientSecret(clientSecret)
    .build()

  return PDFServicesSdk.ExecutionContext.create(credentials)
}

export async function convertPdfToWord(media: any, _message: any): Promise<any> { 
  const context = getAdobeContext()
  if (!context) {
    console.log('Skipping PDF to Word convert: Adobe credentials missing.')
    return false
  }

  return new Promise((resolve) => {
    tmp.dir({ unsafeCleanup: true }, async (err, dirPath, cleanupCallback) => {
      if (err) return resolve(false)
      
      try {
        const inputPath = path.join(dirPath, 'input.pdf')
        const outputPath = path.join(dirPath, `${Date.now()}.docx`)
        
        await fs.writeFile(inputPath, media.data, 'base64')
        
        const exportPdfOperation = PDFServicesSdk.ExportPDF.Operation.createNew(PDFServicesSdk.ExportPDF.SupportedTargetFormats.DOCX)
        const input = PDFServicesSdk.FileRef.createFromLocalFile(inputPath)
        exportPdfOperation.setInput(input)
        
        const result = await exportPdfOperation.execute(context)
        await result.saveAsFile(outputPath)
        
        const { MessageMedia } = await import('whatsapp-web.js')
        const wordMedia = await MessageMedia.fromFilePath(outputPath)
        resolve(wordMedia)
      } catch (e) {
        console.error('Exception encountered while converting PDF to Word:', e)
        resolve(false)
      } finally {
        cleanupCallback()
      }
    })
  })
}

export async function convertWordToPdf(media: any, _message: any): Promise<any> { 
  const context = getAdobeContext()
  if (!context) {
    console.log('Skipping Word to PDF convert: Adobe credentials missing.')
    return false
  }

  return new Promise((resolve) => {
    tmp.dir({ unsafeCleanup: true }, async (err, dirPath, cleanupCallback) => {
      if (err) return resolve(false)
      
      try {
        const inputPath = path.join(dirPath, 'input.docx')
        const outputPath = path.join(dirPath, `${Date.now()}.pdf`)
        
        await fs.writeFile(inputPath, media.data, 'base64')
        
        const createPdfOperation = PDFServicesSdk.CreatePDF.Operation.createNew()
        const input = PDFServicesSdk.FileRef.createFromLocalFile(inputPath, PDFServicesSdk.CreatePDF.SupportedSourceFormat.docx)
        createPdfOperation.setInput(input)
        
        const result = await createPdfOperation.execute(context)
        await result.saveAsFile(outputPath)
        
        const { MessageMedia } = await import('whatsapp-web.js')
        const pdfMedia = await MessageMedia.fromFilePath(outputPath)
        resolve(pdfMedia)
      } catch (e) {
        console.error('Exception encountered while converting Word to PDF:', e)
        resolve(false)
      } finally {
        cleanupCallback()
      }
    })
  })
}

export async function createAudioPrediction2(_message: any) {
  return { transcription: "Transcripción de prueba generada", audioFilePath: null, detectedLanguage: "es" }
}

export async function sendEmail(data: any) {
  console.log('Sending Email:', data)
  return { status: 200 }
}

export async function getBase64FromEndpoint(endpoint: string) {
  const response = await axios.get(endpoint, { responseType: 'arraybuffer' });
  const b64data = Buffer.from(response.data, 'binary').toString('base64');
  return [{ mimetype: response.headers['content-type'] || 'image/png', data: b64data }];
}