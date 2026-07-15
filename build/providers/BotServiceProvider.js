"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const BotService_1 = __importDefault(require("../app/Services/BotService"));
const ScheduleService_1 = __importDefault(require("../app/Services/ScheduleService"));
class BotServiceProvider {
    constructor(app) {
        this.app = app;
    }
    register() {
        this.app.container.singleton('App/Services/BotService', () => {
            return new BotService_1.default();
        });
        this.app.container.singleton('App/Services/ScheduleService', () => {
            return new ScheduleService_1.default();
        });
    }
    async boot() {
        const botService = this.app.container.use('App/Services/BotService');
        await botService.init();
        const scheduleService = this.app.container.use('App/Services/ScheduleService');
        await scheduleService.init();
    }
    async ready() { }
    async shutdown() {
        const botService = this.app.container.use('App/Services/BotService');
        console.log('BotServiceProvider: Initiating graceful WhatsApp shutdown...');
        await botService.shutdown();
        const scheduleService = this.app.container.use('App/Services/ScheduleService');
        await scheduleService.shutdown();
    }
}
exports.default = BotServiceProvider;
//# sourceMappingURL=BotServiceProvider.js.map