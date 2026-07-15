"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const Env_1 = __importDefault(global[Symbol.for('ioc.use')]("Adonis/Core/Env"));
class BasicAuth {
    async handle({ request, response }, next) {
        const authHeader = request.header('authorization');
        if (!authHeader) {
            response.header('WWW-Authenticate', 'Basic realm="Secure WhatsApp Manager"');
            return response.unauthorized('Authentication required');
        }
        const base64Credentials = authHeader.split(' ')[1];
        const credentials = Buffer.from(base64Credentials, 'base64').toString('ascii');
        const [username, password] = credentials.split(':');
        const validUsername = Env_1.default.get('ADMIN_USERNAME');
        const validPassword = Env_1.default.get('ADMIN_PASSWORD');
        if (username !== validUsername || password !== validPassword) {
            response.header('WWW-Authenticate', 'Basic realm="Secure WhatsApp Manager"');
            return response.unauthorized('Invalid credentials');
        }
        await next();
    }
}
exports.default = BasicAuth;
//# sourceMappingURL=BasicAuth.js.map