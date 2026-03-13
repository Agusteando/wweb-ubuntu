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
    this.app.container.use('App/Services/BotService')
  }

  public async ready() {}
  public async shutdown() {}
}