import type { ApplicationContract } from '@ioc:Adonis/Core/Application'

export default class BotServiceProvider {
  constructor(protected app: ApplicationContract) {}

  public register() {
    this.app.container.singleton('App/Services/BotService', () => {
      // Dynamic require ensures it's lazily loaded
      const BotService = require('App/Services/BotService').default
      return BotService
    })
  }

  public async boot() {
    // Initiate boot sequence
    this.app.container.use('App/Services/BotService')
  }

  public async ready() {}
  public async shutdown() {}
}