import type { ApplicationContract } from '@ioc:Adonis/Core/Application'
import BotService from '../app/Services/BotService'
import ScheduleService from '../app/Services/ScheduleService'

export default class BotServiceProvider {
  constructor(protected app: ApplicationContract) {}

  public register() {
    this.app.container.singleton('App/Services/BotService', () => {
      return new BotService()
    })
    this.app.container.singleton('App/Services/ScheduleService', () => {
      return new ScheduleService()
    })
  }

  public async boot() {
    const botService = this.app.container.use('App/Services/BotService') as BotService
    await botService.init()

    const scheduleService = this.app.container.use('App/Services/ScheduleService') as ScheduleService
    await scheduleService.init()
  }

  public async ready() {}

  public async shutdown() {
    const botService = this.app.container.use('App/Services/BotService') as BotService
    console.log('BotServiceProvider: Initiating graceful WhatsApp shutdown...')
    await botService.shutdown()

    const scheduleService = this.app.container.use('App/Services/ScheduleService') as ScheduleService
    await scheduleService.shutdown()
  }
}