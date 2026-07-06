import { describe, expect, it, afterEach } from 'vitest';
import { CredentialRegistry } from './credentials';
import { MusterBridgeServer } from './server';

describe('MusterBridgeServer auth', () => {
  let server: MusterBridgeServer | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it('rejects missing bearer with 401', async () => {
    const credentials = new CredentialRegistry();
    server = new MusterBridgeServer({
      credentials,
      toolHandler: { handleToolCall: async () => ({ ok: true, result: {} }) },
    });
    const { port } = await server.listen();
    const res = await fetch(`http://127.0.0.1:${port}/mcp`, { method: 'POST', body: '{}' });
    expect(res.status).toBe(401);
  });

  it('accepts valid token with loopback host and absent origin on initialize', async () => {
    const credentials = new CredentialRegistry();
    server = new MusterBridgeServer({
      credentials,
      toolHandler: { handleToolCall: async () => ({ ok: true, result: {} }) },
    });
    const { port } = await server.listen();
    const token = credentials.issue({
      rootId: 'r',
      callerTaskId: 't',
      turnId: 'turn-1',
      allowedActions: new Set(['ask_user']),
      ttlMs: 60_000,
    });
    const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-03-26',
          capabilities: {},
          clientInfo: { name: 'test', version: '0' },
        },
      }),
    });
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });
});