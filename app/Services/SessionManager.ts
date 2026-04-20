export interface UserSession {
  adjuntados: any[];
  alternateAdjuntados: any[];
  autoStorePDF: boolean;
  skip: boolean;
  waiting: boolean;
  cmd: string | null;
  remember: any;
  ticketState: string | null;
  [key: string]: any;
}

class SessionManager {
  private sessions = new Map<string, UserSession>();

  public getOrCreate(userId: string): UserSession {
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
    return this.sessions.get(userId)!;
  }

  public update(userId: string, data: Partial<UserSession>) {
    const session = this.getOrCreate(userId);
    Object.assign(session, data);
  }

  public clearInteraction(userId: string) {
    this.update(userId, { waiting: false, cmd: null, remember: null, ticketState: null });
  }
}

export default new SessionManager();