import Route from '@ioc:Adonis/Core/Route'
import Application from '@ioc:Adonis/Core/Application'
import type BotService from 'App/Services/BotService'

Route.get('/', async ({ view }) => {
  // Resolve the singleton instance rather than calling off the uninstantiated class mapping
  const botService = Application.container.use('App/Services/BotService') as BotService
  
  const clientsData = Array.from(botService.statuses.entries()).map(([clientId, status]) => {
    let displayStatus = 'Awaiting QR'
    if (botService.qrCodes.get(clientId)) displayStatus = 'QR Received'
    else if (status === 'ready') displayStatus = 'Connected'
    else if (status === 'error') displayStatus = 'Error'
    return {
      clientId,
      status: displayStatus,
      commandFile: botService.commands.get(clientId)?.fileName || ''
    }
  })
  
  const commandFiles = await botService.getCommandFiles()
  return view.render('bot', { clients: clientsData, commandFiles })
})

Route.get('/whatsapp-manager/resources/js/bot.js', ({ response }) => {
  const filePath = Application.resourcesPath('js/bot.js')
  return response.attachment(filePath)
})

Route.post('/whatsapp-manager/bot/add', 'BotController.add')
Route.post('/whatsapp-manager/bot/set-command', 'BotController.setCommand')
Route.post('/whatsapp-manager/bot/remove', 'BotController.remove')
Route.get('/whatsapp-manager/bot/qr', 'BotController.qr')
Route.post('/whatsapp-manager/bot/send/:clientId', 'BotController.sendMessage')