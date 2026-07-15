"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
class ExampleCommand {
    constructor() {
        this.type = 'Command';
        this.instructions = '!hello | !echo <text>';
    }
    async handle(message, _client, _session) {
        const body = message.body || " ";
        const cmd = body.split(" ")[0].toLowerCase();
        const args = body.split(" ").filter(arg => arg.trim() !== '');
        switch (cmd) {
            case "!hello":
                await message.reply("Hi there! I am your assigned multi-client bot.");
                break;
            case "!echo":
                const text = args.slice(1).join(" ");
                await message.reply(text || "Say something!");
                break;
            default:
                break;
        }
    }
}
exports.default = ExampleCommand;
//# sourceMappingURL=ExampleCommand.js.map