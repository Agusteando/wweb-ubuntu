import type { ApplicationContract } from '@ioc:Adonis/Core/Application'

export default class BotServiceProvider {
  constructor(protected app: ApplicationContract) {}

  public register() {
    this.app.container.singleton('App/Services/BotService', () => {
      // By using the App/ alias, we guarantee the Adonis TS compiler intercepts it properly on Ubuntu
      const BotService = require('App/Services/BotService').default
      return new BotService()
    })
  }

  public async boot() {
    this.app.container.use('App/Services/BotService')
  }

  public async ready() {}
  public async shutdown() {}
}