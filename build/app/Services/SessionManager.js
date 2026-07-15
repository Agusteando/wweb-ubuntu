"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
class SessionManager {
    constructor() {
        this.sessions = new Map();
    }
    getOrCreate(userId) {
        if (!this.sessions.has(userId)) {
            this.sessions.set(userId, {
                adjuntados: [],
                alternateAdjuntados: [],
                autoStorePDF: false,
                skip: false,
                waiting: false,
                cmd: null,
                remember: null,
                ticketState: null,
            });
        }
        return this.sessions.get(userId);
    }
    update(userId, data) {
        const session = this.getOrCreate(userId);
        Object.assign(session, data);
    }
    clearInteraction(userId) {
        this.update(userId, { waiting: false, cmd: null, remember: null, ticketState: null });
    }
}
exports.default = new SessionManager();
//# sourceMappingURL=SessionManager.js.map