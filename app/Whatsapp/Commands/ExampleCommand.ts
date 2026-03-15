import { Client, Message } from 'whatsapp-web.js'
import { UserSession } from '../../Services/SessionManager'

export default class ExampleCommand {
  public type = 'Command'
  public instructions = '!hello | !echo <text>'

  async handle(message: Message, _client: Client, _session: UserSession) {
    const body = message.body || " "
    const cmd = body.split(" ")[0].toLowerCase()
    const args = body.split(" ").filter(arg => arg.trim() !== '')

    switch (cmd) {
      case "!hello":
        await message.reply("Hi there! I am your assigned multi-client bot.")
        break
      case "!echo":
        const text = args.slice(1).join(" ")
        await message.reply(text || "Say something!")
        break
      default:
        break
    }
  }
}