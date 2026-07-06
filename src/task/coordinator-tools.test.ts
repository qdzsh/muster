import { describe, expect, it } from 'vitest';
import { dispatch } from './coordinator-tools';
import type { CredentialContext } from '../bridge/credentials';

function ctx(actions: string[]): CredentialContext {
  return {
    credentialId: 'c1',
    rootId: 'root',
    callerTaskId: 'task-1',
    turnId: 'turn-1',
    allowedActions: new Set(actions as import('./capabilities').ToolAction[]),
    expiry: Date.now() + 60_000,
  };
}

describe('coordinator-tools dispatch', () => {
  it('maps create_task to ToolCommand', () => {
    const result = dispatch(
      'create_task',
      { opId: 'op-1', goal: 'child goal', backend: 'grok' },
      ctx(['create_task', 'ask_user']),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.command.kind).toBe('create_task');
    }
  });

  it('rejects missing opId', () => {
    const result = dispatch('start_task', { childId: 'c1' }, ctx(['start_task']));
    expect(result).toEqual({ ok: false, toolError: 'opId is required' });
  });

  it('rejects action outside allowedActions', () => {
    const result = dispatch(
      'create_task',
      { opId: 'op-1', goal: 'g', backend: 'grok' },
      ctx(['ask_user']),
    );
    expect(result).toEqual({ ok: false, toolError: 'action not permitted: create_task' });
  });

  it('rejects invalid known executionPolicy fields', () => {
    const result = dispatch(
      'create_task',
      {
        opId: 'op-1',
        goal: 'child',
        backend: 'grok',
        executionPolicy: { maxTurns: -1, turnTimeoutMs: 60_000 },
      },
      ctx(['create_task']),
    );
    expect(result).toEqual({ ok: false, toolError: 'invalid create_task arguments' });
  });

  it('accepts zero maxAutomaticRetries', () => {
    const result = dispatch(
      'create_task',
      {
        opId: 'op-1',
        goal: 'child',
        backend: 'grok',
        executionPolicy: { maxAutomaticRetries: 0 },
      },
      ctx(['create_task']),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.command.kind).toBe('create_task');
      if (result.command.kind === 'create_task') {
        expect(result.command.spec.executionPolicy?.maxAutomaticRetries).toBe(0);
      }
    }
  });
});