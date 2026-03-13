import { HttpContextContract } from '@ioc:Adonis/Core/HttpContext'
import Env from '@ioc:Adonis/Core/Env'

export default class BasicAuth {
  public async handle({ request, response }: HttpContextContract, next: () => Promise<void>) {
    const authHeader = request.header('authorization')
    
    if (!authHeader) {
      response.header('WWW-Authenticate', 'Basic realm="Secure WhatsApp Manager"')
      return response.unauthorized('Authentication required')
    }

    const base64Credentials = authHeader.split(' ')[1]
    const credentials = Buffer.from(base64Credentials, 'base64').toString('ascii')
    const [username, password] = credentials.split(':')

    const validUsername = Env.get('ADMIN_USERNAME')
    const validPassword = Env.get('ADMIN_PASSWORD')

    if (username !== validUsername || password !== validPassword) {
      response.header('WWW-Authenticate', 'Basic realm="Secure WhatsApp Manager"')
      return response.unauthorized('Invalid credentials')
    }

    await next()
  }
}