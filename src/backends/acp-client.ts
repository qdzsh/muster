import { ChildProcessWithoutNullStreams, spawn } from 'child_process';
import { createInterface, Interface } from 'readline';
import { McpServerConfig } from '../types';

type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer?: ReturnType<typeof setTimeout>;
};

export type SessionUpdate = Record<string, unknown>;

export interface PromptResult {
  stopReason?: string;
  _meta?: Record<string, unknown>;
}

type SessionSink = (update: SessionUpdate) => void;
type ConnectionSink = (line: string, source: 'stderr' | 'non-json') => void;

let sharedClient: AcpClient | undefined;

export function getSharedAcpClient(): AcpClient {
  if (!sharedClient) {
    sharedClient = new AcpClient();
  }
  return sharedClient;
}

export function disposeSharedAcpClient(): void {
  sharedClient?.dispose();
  sharedClient = undefined;
}

export class AcpClient {
  private proc?: ChildProcessWithoutNullStreams;
  private rl?: Interface;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private sessionSinks = new Map<string, Set<SessionSink>>();
  private connectionSinks = new Set<ConnectionSink>();
  private connectPromise?: Promise<void>;
  private extraEnv?: Record<string, string>;
  private authenticated = false;
  loadSessionSupported = false;

  registerSessionSink(sessionId: string, sink: SessionSink): () => void {
    let sinks = this.sessionSinks.get(sessionId);
    if (!sinks) {
      sinks = new Set();
      this.sessionSinks.set(sessionId, sinks);
    }
    sinks.add(sink);
    return () => {
      sinks!.delete(sink);
      if (sinks!.size === 0) this.sessionSinks.delete(sessionId);
    };
  }

  registerConnectionSink(sink: ConnectionSink): () => void {
    this.connectionSinks.add(sink);
    return () => {
      this.connectionSinks.delete(sink);
    };
  }

  async ensureConnected(extraEnv?: Record<string, string>): Promise<void> {
    if (extraEnv) this.extraEnv = extraEnv;
    if (this.connectPromise) return this.connectPromise;

    this.connectPromise = this.startAndHandshake().catch((err) => {
      this.connectPromise = undefined;
      this.teardownProcess();
      throw err;
    });
    return this.connectPromise;
  }

  async newSession(cwd: string, mcpServers: McpServerConfig[]): Promise<{ sessionId: string }> {
    await this.ensureConnected();
    const res = (await this.request('session/new', { cwd, mcpServers })) as { sessionId: string };
    return { sessionId: res.sessionId };
  }

  async loadSession(
    sessionId: string,
    cwd: string,
    mcpServers: McpServerConfig[],
  ): Promise<{ sessionId: string }> {
    await this.ensureConnected();
    if (!this.loadSessionSupported) {
      throw new Error('Grok agent does not support session/load');
    }
    await this.request('session/load', { sessionId, cwd, mcpServers });
    return { sessionId };
  }

  async prompt(sessionId: string, text: string): Promise<PromptResult> {
    await this.ensureConnected();
    return (await this.request('session/prompt', {
      sessionId,
      prompt: [{ type: 'text', text }],
    })) as PromptResult;
  }

  cancel(sessionId: string): void {
    // ACP defines session/cancel as a notification (no id).
    this.notify('session/cancel', { sessionId });
  }

  dispose(): void {
    this.teardownProcess();
    this.connectPromise = undefined;
    this.rejectAllPending(new Error('ACP client disposed'));
    this.sessionSinks.clear();
    this.connectionSinks.clear();
  }

  private mergedEnv(): NodeJS.ProcessEnv {
    return { ...process.env, ...this.extraEnv };
  }

  private emitConnectionLine(line: string, source: 'stderr' | 'non-json'): void {
    for (const sink of this.connectionSinks) {
      sink(line, source);
    }
  }

  private teardownProcess(): void {
    const proc = this.proc;
    this.proc = undefined;
    this.authenticated = false;
    this.rl?.close();
    this.rl = undefined;
    try {
      proc?.kill();
    } catch {
      // already gone
    }
  }

  private async startAndHandshake(): Promise<void> {
    if (this.authenticated && this.proc && this.proc.exitCode === null && this.proc.signalCode === null) {
      return;
    }

    this.teardownProcess();

    const env = this.mergedEnv();
    const proc = spawn('grok', ['--no-auto-update', 'agent', 'stdio'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
    });
    this.proc = proc;

    this.rl = createInterface({ input: proc.stdout });
    this.rl.on('line', (line) => this.onLine(line));

    proc.stdin.on('error', () => {
      // Swallow EPIPE after exit — writeLine handles the synchronous path.
    });

    proc.stderr.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString().split('\n')) {
        if (line.trim()) this.emitConnectionLine(line, 'stderr');
      }
    });

    proc.on('exit', (code) => {
      if (this.proc !== proc) return;
      this.proc = undefined;
      this.authenticated = false;
      this.connectPromise = undefined;
      this.rejectAllPending(new Error(`Grok agent exited (code ${code})`));
    });

    proc.on('error', (err) => {
      if (this.proc !== proc) return;
      this.connectPromise = undefined;
      this.rejectAllPending(err);
    });

    try {
      const init = (await this.request('initialize', {
        protocolVersion: 1,
        clientCapabilities: {
          fs: { readTextFile: false, writeTextFile: false },
          terminal: false,
        },
      })) as {
        authMethods?: { id: string }[];
        agentCapabilities?: { loadSession?: boolean };
      };

      this.loadSessionSupported = !!init.agentCapabilities?.loadSession;

      const authMethods = new Set((init.authMethods ?? []).map((m) => m.id));
      const methodId =
        env.XAI_API_KEY && authMethods.has('xai.api_key')
          ? 'xai.api_key'
          : authMethods.has('cached_token')
            ? 'cached_token'
            : null;

      if (!methodId) {
        throw new Error('Run `grok login` first, or set XAI_API_KEY.');
      }

      await this.request('authenticate', { methodId, _meta: { headless: true } });
      this.authenticated = true;
    } catch (err) {
      this.teardownProcess();
      throw err;
    }
  }

  private rejectAllPending(err: Error): void {
    for (const [id, p] of this.pending) {
      this.pending.delete(id);
      if (p.timer) clearTimeout(p.timer);
      p.reject(err);
    }
  }

  private request(method: string, params: unknown, timeoutMs?: number): Promise<unknown> {
    const id = this.nextId++;
    const timeout = timeoutMs ?? (method === 'session/prompt' ? 1_800_000 : 120_000);

    return new Promise((resolve, reject) => {
      const entry: Pending = {
        resolve,
        reject,
      };
      this.pending.set(id, entry);

      if (!this.writeLine({ jsonrpc: '2.0', id, method, params })) {
        this.pending.delete(id);
        reject(new Error(`Grok agent is not running (${method})`));
        return;
      }

      entry.timer = setTimeout(() => {
        if (this.pending.delete(id)) {
          reject(new Error(`ACP request timed out: ${method}`));
        }
      }, timeout);
    });
  }

  private notify(method: string, params: unknown): void {
    this.writeLine({ jsonrpc: '2.0', method, params });
  }

  private writeLine(obj: unknown): boolean {
    const proc = this.proc;
    if (!proc || proc.killed || !proc.stdin.writable) return false;
    try {
      proc.stdin.write(JSON.stringify(obj) + '\n');
      return true;
    } catch {
      return false;
    }
  }

  private respondOk(id: number | string, result: unknown = {}): void {
    this.writeLine({ jsonrpc: '2.0', id, result });
  }

  private respondError(id: number | string, code: number, message: string): void {
    this.writeLine({ jsonrpc: '2.0', id, error: { code, message } });
  }

  private onLine(line: string): void {
    if (!line.trim()) return;

    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(line);
    } catch {
      this.emitConnectionLine(line, 'non-json');
      return;
    }

    if (msg.method === 'session/update') {
      const params = msg.params as { sessionId?: string; update?: SessionUpdate } | undefined;
      const sessionId = params?.sessionId;
      const update = params?.update;
      if (sessionId && update) {
        const sinks = this.sessionSinks.get(sessionId);
        if (sinks) {
          for (const sink of sinks) sink(update);
        }
      }
      return;
    }

    if (msg.id != null && msg.method == null) {
      const p = this.pending.get(msg.id as number);
      if (p) {
        this.pending.delete(msg.id as number);
        if (p.timer) clearTimeout(p.timer);
        if (msg.error) {
          const err = msg.error as { message?: string };
          p.reject(new Error(err.message ?? JSON.stringify(msg.error)));
        } else {
          p.resolve(msg.result);
        }
      }
      return;
    }

    if (msg.method && msg.id != null) {
      void this.handleServerRequest(msg);
    }
  }

  private async handleServerRequest(msg: Record<string, unknown>): Promise<void> {
    const method = msg.method as string;
    const id = msg.id as number | string;
    const params = (msg.params ?? {}) as Record<string, unknown>;

    try {
      if (method === 'session/request_permission') {
        const options = (params.options ?? []) as { optionId: string; kind: string }[];
        const allow =
          options.find((o) => /allow/i.test(o.kind)) ??
          options.find((o) => o.optionId === 'allow_once') ??
          options[0];
        this.respondOk(id, {
          outcome: { outcome: 'selected', optionId: allow?.optionId ?? 'allow_once' },
        });
        return;
      }

      if (method.startsWith('fs/') || method.startsWith('terminal/')) {
        this.respondError(id, -32601, 'Client capability not supported');
        return;
      }

      if (
        method === 'x.ai/ask_user_question' ||
        method === '_x.ai/ask_user_question'
      ) {
        this.respondOk(id, { outcome: 'cancelled' });
        return;
      }

      if (
        method === 'x.ai/exit_plan_mode' ||
        method === '_x.ai/exit_plan_mode'
      ) {
        this.respondOk(id, { outcome: 'approved' });
        return;
      }

      // Unknown server request — ack so the agent does not hang.
      this.respondOk(id, {});
    } catch (err) {
      this.respondError(id, -32603, (err as Error).message || 'Internal error');
    }
  }
}