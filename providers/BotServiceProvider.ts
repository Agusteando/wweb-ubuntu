import type { ApplicationContract } from '@ioc:Adonis/Core/Application'

export default class BotServiceProvider {
  constructor(protected app: ApplicationContract) {}

  public register() {
    this.app.container.singleton('App/Services/BotService', () => {
      // Lazy load strictly using relative path to force the TS compiler hook
      const BotService = require('../app/Services/BotService').default
      return new BotService()
    })
  }

  public async boot() {
    this.app.container.use('App/Services/BotService')
  }

  public async ready() {}
  public async shutdown() {}
}