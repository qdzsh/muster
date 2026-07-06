import { describe, expect, it } from 'vitest';
import { AskBridge } from './ask-bridge';

describe('AskBridge', () => {
  it('resolves only on matching triplet', async () => {
    const bridge = new AskBridge();
    const ref = { taskId: 't1', turnId: 'turn-1', askId: 'ask-1' };
    const promise = bridge.register(ref, [{ prompt: 'Pick?' }], 5_000);
    expect(bridge.submit({ ...ref, askId: 'wrong' }, { '0': { selected: [], freeText: 'x' } })).toBe(false);
    expect(bridge.submit(ref, { '0': { selected: ['a'], freeText: null } })).toBe(true);
    await expect(promise).resolves.toEqual({ '0': { selected: ['a'], freeText: null } });
  });

  it('cancelForTurn rejects only that turn', async () => {
    const bridge = new AskBridge();
    const p1 = bridge.register({ taskId: 't', turnId: 'turn-a', askId: 'a1' }, [{ prompt: 'A' }], 5_000);
    const p2 = bridge.register({ taskId: 't', turnId: 'turn-b', askId: 'b1' }, [{ prompt: 'B' }], 5_000);
    bridge.cancelForTurn('turn-a', 'cancelled');
    await expect(p1).rejects.toThrow('cancelled');
    bridge.submit({ taskId: 't', turnId: 'turn-b', askId: 'b1' }, { '0': { selected: [], freeText: 'ok' } });
    await expect(p2).resolves.toBeDefined();
  });
});