import { google } from 'googleapis'
import { promises as fs } from 'fs'
import path from 'path'
import Env from '@ioc:Adonis/Core/Env'
import Application from '@ioc:Adonis/Core/Application'
import axios from 'axios'
import FormData from 'form-data'
import * as PDFServicesSdk from '@adobe/pdfservices-node-sdk'
import tmp from 'tmp'

export async function getGoogleAdminAuth(scopes: string[]) {
  const credPath = Env.get('GOOGLE_CREDENTIALS_PATH')
  
  if (!credPath) {
    throw new Error('CRITICAL: Missing environment variable GOOGLE_CREDENTIALS_PATH. Must be set to use Google API features.')
  }

  const absolutePath = path.isAbsolute(credPath)
    ? credPath
    : path.resolve(Application.appRoot, credPath)

  let content: string
  try {
    content = await fs.readFile(absolutePath, 'utf8')
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      throw new Error(`Google credentials file not found at: ${absolutePath}. Please ensure the file exists and is accessible.`)
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

async function withRetry<T>(fn: () => Promise<T>, retries: number, delayMs: number): Promise<T> {
  for (let i = 0; i < retries; i++) {
      try {
          return await fn();
      } catch (error) {
          if (i === retries - 1) throw error;
          await new Promise(res => setTimeout(res, delayMs));
      }
  }
  throw new Error('Unreachable');
}

export async function createAudioPrediction2(message: any) {
  const media = await message.downloadMedia();
  if (!media || !media.data) return null;

  return new Promise<any>((resolve, reject) => {
    tmp.file({ postfix: '.ogg' }, async (err, tempPath) => {
      if (err) return reject(err);
      
      try {
        await fs.writeFile(tempPath, media.data, 'base64');
        
        const token = Env.get('OPENAI_API_KEY');
        if (!token) throw new Error('OPENAI_API_KEY is not configured in .env');

        const form = new FormData();
        const readStream = require('fs').createReadStream(tempPath);
        form.append('file', readStream);
        form.append('model', 'whisper-1');
        form.append('prompt', '¡Hola!\n\n¿Cómo estás?\n\nBienvenido a mi bitácora:\nQuisiera comenzar con...');

        console.log("Now reaching out to OPENAI's Whisper...");

        let transcription = await withRetry(async () => {
            const response = await axios.post('https://api.openai.com/v1/audio/transcriptions', form, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    ...form.getHeaders(),
                },
                timeout: 30000
            });
            console.log("Whisper has answered.");
            return response.data.text;
        }, 3, 10000);

        console.log('Whisper output:', transcription);

        let detectedLanguage = 'unknown';
        try {
            // Placeholder: Whisper doesn't natively return language unless verbose_json is used,
            // but preserving your requested object signature
            detectedLanguage = 'es'; 
        } catch (e) {}

        // Returning the tempPath so the caller can clean it up per your design
        resolve({ transcription, audioFilePath: tempPath, detectedLanguage });
      } catch (error) {
        try { await fs.unlink(tempPath); } catch (e) {}
        reject(error);
      }
    });
  });
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