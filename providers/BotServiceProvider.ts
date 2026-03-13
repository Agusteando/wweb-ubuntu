import type { ApplicationContract } from '@ioc:Adonis/Core/Application'
import BotService from '../app/Services/BotService'

export default class BotServiceProvider {
  constructor(protected app: ApplicationContract) {}

  public register() {
    // Bind the service as a singleton
    this.app.container.singleton('App/Services/BotService', () => {
      // Instantiate and return the BotService class
      return new BotService()
    })
  }

  public async boot() {
    // This instantiates the singleton when the application boots
    this.app.container.use('App/Services/BotService')
  }

  public async ready() {}
  public async shutdown() {}
}