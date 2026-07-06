import { randomBytes } from 'crypto';
import type { ToolAction } from '../task/capabilities';

export interface CredentialContext {
  credentialId: string;
  rootId: string;
  callerTaskId: string;
  turnId: string;
  allowedActions: ReadonlySet<ToolAction>;
  expiry: number;
}

interface StoredCredential extends CredentialContext {
  token: string;
}

export class CredentialRegistry {
  private readonly byToken = new Map<string, StoredCredential>();
  private readonly byTurnId = new Map<string, string>();

  issue(params: {
    rootId: string;
    callerTaskId: string;
    turnId: string;
    allowedActions: ReadonlySet<ToolAction>;
    ttlMs: number;
  }): string {
    this.revoke(params.turnId);
    const token = randomBytes(32).toString('hex');
    const credentialId = randomBytes(8).toString('hex');
    const stored: StoredCredential = {
      credentialId,
      rootId: params.rootId,
      callerTaskId: params.callerTaskId,
      turnId: params.turnId,
      allowedActions: params.allowedActions,
      expiry: Date.now() + params.ttlMs,
      token,
    };
    this.byToken.set(token, stored);
    this.byTurnId.set(params.turnId, token);
    return token;
  }

  verify(token: string): CredentialContext | null {
    const stored = this.byToken.get(token);
    if (!stored) {
      return null;
    }
    if (Date.now() > stored.expiry) {
      this.revoke(stored.turnId);
      return null;
    }
    return {
      credentialId: stored.credentialId,
      rootId: stored.rootId,
      callerTaskId: stored.callerTaskId,
      turnId: stored.turnId,
      allowedActions: stored.allowedActions,
      expiry: stored.expiry,
    };
  }

  revoke(turnId: string): void {
    const token = this.byTurnId.get(turnId);
    if (!token) {
      return;
    }
    this.byToken.delete(token);
    this.byTurnId.delete(turnId);
  }

  revokeAll(): void {
    this.byToken.clear();
    this.byTurnId.clear();
  }
}