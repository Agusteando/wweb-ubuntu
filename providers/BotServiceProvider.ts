import type { ApplicationContract } from '@ioc:Adonis/Core/Application'

// Static top-level import cleanly bypasses the runtime IoC require() trap 
// and relies on the TypeScript compiler to resolve the path correctly on both Linux and Windows.
import BotService from 'App/Services/BotService'

export default class BotServiceProvider {
  constructor(protected app: ApplicationContract) {}

  public register() {
    this.app.container.singleton('App/Services/BotService', () => {
      // Return the directly imported class instance. 
      // No circular dynamic requires = no infinite loops.
      return new BotService()
    })
  }

  public async boot() {
    // This safely initializes the singleton when the application boots
    this.app.container.use('App/Services/BotService')
  }

  public async ready() {}
  public async shutdown() {}
}