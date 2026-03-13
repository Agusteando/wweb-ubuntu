import type { ApplicationContract } from '@ioc:Adonis/Core/Application'
import BotService from '../app/Services/BotService'

export default class BotServiceProvider {
  constructor(protected app: ApplicationContract) {}

  public register() {
    this.app.container.singleton('App/Services/BotService', () => {
      return new BotService()
    })
  }

  public async boot() {
    // Initialize bots securely on boot to rehydrate sessions and listeners
    const botService = this.app.container.use('App/Services/BotService') as BotService
    await botService.init()
  }

  public async ready() {}
  public async shutdown() {}
}