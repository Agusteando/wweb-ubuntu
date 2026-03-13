import Route from '@ioc:Adonis/Core/Route'
import Application from '@ioc:Adonis/Core/Application'

Route.get('/', 'BotController.index')

Route.get('/whatsapp-manager/resources/js/bot.js', ({ response }) => response.attachment(Application.resourcesPath('js/bot.js')))

// Web Manager Routes
Route.post('/whatsapp-manager/bot/add', 'BotController.add')
Route.post('/whatsapp-manager/bot/remove', 'BotController.remove')
Route.post('/whatsapp-manager/bot/set-command', 'BotController.setCommand')
Route.get('/whatsapp-manager/bot/qr', 'BotController.qr')

// API Routes (Both /api/ and /bot/ prefixes preserved to ensure no integration breaks)
Route.post('/whatsapp-manager/bot/send/:clientId', 'BotController.sendMessage')
Route.post('/whatsapp-manager/api/send/:clientId', 'BotController.sendMessage')

Route.post('/whatsapp-manager/bot/send-media/:clientId', 'BotController.sendMedia')
Route.post('/whatsapp-manager/api/send-media/:clientId', 'BotController.sendMedia')