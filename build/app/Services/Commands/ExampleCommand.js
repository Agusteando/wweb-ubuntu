"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
class ExampleCommand {
    constructor(client) {
        this.client = client;
    }
    async response(message) {
        const body = message.body || " ";
        const cmd = body.split(" ")[0].toLowerCase();
        const args = body.split(" ").filter(arg => arg.trim() !== '');
        switch (cmd) {
            case "!hello":
                await message.reply("Hi there!");
                break;
            case "!echo":
                const text = args.slice(1).join(" ");
                await message.reply(text || "Say something!");
                break;
            default:
        }
    }
}
exports.default = ExampleCommand;
//# sourceMappingURL=ExampleCommand.js.map