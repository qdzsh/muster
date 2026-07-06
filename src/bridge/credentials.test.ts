import { describe, expect, it } from 'vitest';
import { CredentialRegistry } from './credentials';

describe('CredentialRegistry', () => {
  it('issues and verifies a credential', () => {
    const registry = new CredentialRegistry();
    const token = registry.issue({
      rootId: 'root-1',
      callerTaskId: 'task-1',
      turnId: 'turn-1',
      allowedActions: new Set(['ask_user']),
      ttlMs: 60_000,
    });
    const ctx = registry.verify(token);
    expect(ctx?.callerTaskId).toBe('task-1');
    expect(ctx?.turnId).toBe('turn-1');
    expect(ctx?.allowedActions.has('ask_user')).toBe(true);
  });

  it('returns null for unknown or revoked tokens', () => {
    const registry = new CredentialRegistry();
    expect(registry.verify('bad')).toBeNull();
    const token = registry.issue({
      rootId: 'r',
      callerTaskId: 't',
      turnId: 'turn-2',
      allowedActions: new Set(['ask_user']),
      ttlMs: 60_000,
    });
    registry.revoke('turn-2');
    expect(registry.verify(token)).toBeNull();
  });
});