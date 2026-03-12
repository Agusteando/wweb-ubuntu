import { Client, Message } from 'whatsapp-web.js'

export default class ExampleCommand {
  private client: Client
  public fileName?: string

  constructor(client: Client) {
    this.client = client
  }

  async response(message: Message) {
    const body = message.body || " "
    const cmd = body.split(" ")[0].toLowerCase()
    const args = body.split(" ").filter(arg => arg.trim() !== '')

    switch (cmd) {
      case "!hello":
        await message.reply("Hi there!")
        break
      case "!echo":
        const text = args.slice(1).join(" ")
        await message.reply(text || "Say something!")
        break
      default:
    }
  }
}