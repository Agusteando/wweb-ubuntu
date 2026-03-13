import Route from '@ioc:Adonis/Core/Route'
import Application from '@ioc:Adonis/Core/Application'
import type BotService from 'App/Services/BotService'

Route.get('/', async ({ view }) => {
  const botService = Application.container.use('App/Services/BotService') as BotService
  const clientsData = Array.from(botService.statuses.entries()).map(([clientId, status]) => ({
    clientId,
    status: botService.qrCodes.get(clientId) ? 'QR Received' : (status === 'ready' ? 'Connected' : (status === 'error' ? 'Error' : 'Awaiting QR'))
  }))
  return view.render('bot', { clients: clientsData })
})

Route.get('/whatsapp-manager/resources/js/bot.js', ({ response }) => response.attachment(Application.resourcesPath('js/bot.js')))

Route.post('/whatsapp-manager/bot/add', 'BotController.add')
Route.post('/whatsapp-manager/bot/remove', 'BotController.remove')
Route.get('/whatsapp-manager/bot/qr', 'BotController.qr')

// API Routes
Route.post('/whatsapp-manager/api/send/:clientId', 'BotController.sendMessage')
Route.post('/whatsapp-manager/api/send-media/:clientId', 'BotController.sendMedia')