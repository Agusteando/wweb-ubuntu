import { google } from 'googleapis'
import { promises as fs } from 'fs'
import path from 'path'
import Env from '@ioc:Adonis/Core/Env'
import Application from '@ioc:Adonis/Core/Application'
import axios from 'axios'

export async function getGoogleAdminAuth(scopes: string[]) {
  const credPath = Env.get('GOOGLE_CREDENTIALS_PATH', 'credentials.json')
  const content = await fs.readFile(path.resolve(Application.appRoot, credPath), 'utf8')
  const auth = JSON.parse(content)
  
  // Guard against API changes by utilizing the explicit object-based JWTOptions constructor 
  const client = new google.auth.JWT({
    email: auth.client_email,
    key: auth.private_key,
    scopes: scopes,
    subject: Env.get('G_SUITE_ADMIN_EMAIL', 'desarrollo.tecnologico@casitaiedis.edu.mx')
  })
  
  await client.authorize()
  return client
}

export async function convertPdfToWord(media: any, _message: any) { 
  console.log('Mocking PDF to Word Convert:', media.filename)
  return false 
}

export async function convertWordToPdf(media: any, _message: any) { 
  console.log('Mocking Word to PDF Convert:', media.filename)
  return false 
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