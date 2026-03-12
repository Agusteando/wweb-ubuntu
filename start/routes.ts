import Route from '@ioc:Adonis/Core/Route'
import BotService from '@ioc:App/Services/BotService'
import Application from '@ioc:Adonis/Core/Application'

Route.get('/', async ({ view }) => {
  const clientsData = Array.from(BotService.statuses.entries()).map(([clientId, status]) => {
    let displayStatus = 'Awaiting QR'
    if (BotService.qrCodes.get(clientId)) displayStatus = 'QR Received'
    else if (status === 'ready') displayStatus = 'Connected'
    else if (status === 'error') displayStatus = 'Error'
    return {
      clientId,
      status: displayStatus,
      commandFile: BotService.commands.get(clientId)?.fileName || ''
    }
  })
  
  const commandFiles = await BotService.getCommandFiles()
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