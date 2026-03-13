import Route from '@ioc:Adonis/Core/Route'
import Application from '@ioc:Adonis/Core/Application'

// Protected Web Manager Routes
Route.group(() => {
  Route.get('/', 'BotController.index')
  
  Route.get('/whatsapp-manager/resources/js/bot.js', ({ response }) => response.attachment(Application.resourcesPath('js/bot.js')))

  Route.post('/whatsapp-manager/bot/add', 'BotController.add')
  Route.post('/whatsapp-manager/bot/remove', 'BotController.remove')
  Route.post('/whatsapp-manager/bot/set-commands', 'BotController.setCommands')
  Route.get('/whatsapp-manager/bot/qr', 'BotController.qr')

  // Code Editor Routes
  Route.get('/whatsapp-manager/editor/files', 'BotController.getEditorFiles')
  Route.get('/whatsapp-manager/editor/file/:name', 'BotController.getEditorFileContent')
  Route.post('/whatsapp-manager/editor/file', 'BotController.saveEditorFile')
  Route.post('/whatsapp-manager/editor/file/create', 'BotController.createEditorFile')

}).middleware('auth') // Applying Native Browser Protection

// API Routes (Kept accessible or you can protect them if needed)
Route.post('/whatsapp-manager/bot/send/:clientId', 'BotController.sendMessage')
Route.post('/whatsapp-manager/api/send/:clientId', 'BotController.sendMessage')

Route.post('/whatsapp-manager/bot/send-media/:clientId', 'BotController.sendMedia')
Route.post('/whatsapp-manager/api/send-media/:clientId', 'BotController.sendMedia')