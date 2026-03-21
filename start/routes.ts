// filepath: start/routes.ts
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

  // Rules & Exceptions Routes
  Route.get('/whatsapp-manager/api/chats/:clientId', 'BotController.getChats')
  Route.post('/whatsapp-manager/api/rules/:clientId', 'BotController.saveRules')

  // Scheduling & Planner Routes
  Route.get('/whatsapp-manager/api/schedules/template', 'BotController.downloadTemplate')
  Route.get('/whatsapp-manager/api/schedules/:clientId', 'BotController.getSchedules')
  Route.post('/whatsapp-manager/api/schedules/:clientId', 'BotController.createSchedule')
  Route.put('/whatsapp-manager/api/schedules/:clientId/:id', 'BotController.updateSchedule')
  Route.delete('/whatsapp-manager/api/schedules/:clientId/:id', 'BotController.deleteSchedule')
  Route.post('/whatsapp-manager/api/schedules/:clientId/bulk', 'BotController.bulkImportSchedules')

}).middleware('auth') // Applying Native Browser Protection

// ==========================================
// PUBLIC STABLE & DYNAMIC API ENDPOINTS
// ==========================================

Route.post('/whatsapp-manager/api/send', 'BotController.sendMessages')
Route.post('/whatsapp-manager/api/edit', 'BotController.editMessage')

Route.post('/whatsapp-manager/bot/send/any', 'BotController.sendMessages')
Route.post('/whatsapp-manager/api/send/any', 'BotController.sendMessages')
Route.post('/whatsapp-manager/bot/edit/any', 'BotController.editMessage')
Route.post('/whatsapp-manager/api/edit/any', 'BotController.editMessage')

Route.post('/whatsapp-manager/bot/send/:clientId', 'BotController.sendMessages')
Route.post('/whatsapp-manager/api/send/:clientId', 'BotController.sendMessages')

Route.post('/whatsapp-manager/bot/edit/:clientId', 'BotController.editMessage')
Route.post('/whatsapp-manager/api/edit/:clientId', 'BotController.editMessage')

Route.post('/whatsapp-manager/bot/send-media', 'BotController.sendMessages')
Route.post('/whatsapp-manager/api/send-media', 'BotController.sendMessages')
Route.post('/whatsapp-manager/bot/send-media/:clientId', 'BotController.sendMessages')
Route.post('/whatsapp-manager/api/send-media/:clientId', 'BotController.sendMessages')