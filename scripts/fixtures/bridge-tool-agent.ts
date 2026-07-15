/**
 * Deterministic MCP HTTP client fixture — connects to live Muster Bridge and calls tools.
 * Env: MUSTER_BRIDGE_URL, MUSTER_BRIDGE_TOKEN, MUSTER_TOOL_SCRIPT
 *   - JSON array of {tool,args}
 *   - "coord-initial" — delegate_task + wait_for_tasks
 *   - "coord-continuation" — report_progress + complete_task
 */
const bridgeUrlEnv = process.env.MUSTER_BRIDGE_URL;
const tokenEnv = process.env.MUSTER_BRIDGE_TOKEN;
const scriptRaw = process.env.MUSTER_TOOL_SCRIPT ?? '[]';

if (!bridgeUrlEnv || !tokenEnv) {
  console.error('MUSTER_BRIDGE_URL and MUSTER_BRIDGE_TOKEN are required');
  process.exit(1);
}

const bridgeUrl: string = bridgeUrlEnv;
const token: string = tokenEnv;

type ToolCall = { tool: string; args: Record<string, unknown> };

function assertToolResult(tool: string, status: number, json: unknown): void {
  if (status >= 400) {
    throw new Error(`tools/call ${tool} HTTP ${status}: ${JSON.stringify(json)}`);
  }
  if (!json || typeof json !== 'object') {
    throw new Error(`tools/call ${tool} returned non-JSON body`);
  }
  const payload = json as Record<string, unknown>;
  if ('error' in payload && payload.error) {
    throw new Error(`tools/call ${tool} JSON-RPC error: ${JSON.stringify(payload.error)}`);
  }
  const result = payload.result as Record<string, unknown> | undefined;
  if (result?.isError) {
    const content = result.content as Array<{ text?: string }> | undefined;
    const text = content?.[0]?.text ?? JSON.stringify(result);
    throw new Error(`tools/call ${tool} MCP isError: ${text}`);
  }
}

function parseToolData(json: unknown): unknown {
  const payload = json as Record<string, unknown>;
  const result = payload.result as Record<string, unknown> | undefined;
  const content = result?.content as Array<{ text?: string }> | undefined;
  const text = content?.[0]?.text;
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function parseMcpBody(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return text;
    }
  }
  const dataLines: string[] = [];
  for (const line of text.split('\n')) {
    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trim());
    }
  }
  if (dataLines.length === 0) {
    return text;
  }
  const last = dataLines[dataLines.length - 1];
  try {
    return JSON.parse(last);
  } catch {
    return last;
  }
}

async function mcpPost(
  body: unknown,
  sessionId?: string,
): Promise<{ status: number; json: unknown; sessionId?: string }> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    Host: new URL(bridgeUrl).host,
  };
  if (sessionId) headers['mcp-session-id'] = sessionId;

  const res = await fetch(bridgeUrl, { method: 'POST', headers, body: JSON.stringify(body) });
  const sessionHeader = res.headers.get('mcp-session-id') ?? undefined;
  const text = await res.text();
  return { status: res.status, json: parseMcpBody(text), sessionId: sessionHeader ?? sessionId };
}

async function callTool(
  sessionId: string | undefined,
  id: number,
  call: ToolCall,
): Promise<{ json: unknown; sessionId?: string; nextId: number }> {
  const result = await mcpPost(
    {
      jsonrpc: '2.0',
      id,
      method: 'tools/call',
      params: { name: call.tool, arguments: call.args },
    },
    sessionId,
  );
  assertToolResult(call.tool, result.status, result.json);
  return { json: result.json, sessionId: result.sessionId, nextId: id + 1 };
}

async function runCoordInitial(sessionId: string | undefined, startId: number): Promise<void> {
  let id = startId;
  let sid = sessionId;

  const delegated = await callTool(sid, id, {
    tool: 'delegate_task',
    args: {
      opId: 'd1',
      goal: 'child work',
      taskType: 'worker',
      backend: 'grok',
      role: 'worker',
    },
  });
  sid = delegated.sessionId;
  id = delegated.nextId;
  const delegateData = parseToolData(delegated.json) as { taskId?: string } | undefined;
  const childId = delegateData?.taskId;
  if (!childId) {
    throw new Error(`delegate_task missing taskId: ${JSON.stringify(delegated.json)}`);
  }

  await callTool(sid, id, {
    tool: 'wait_for_tasks',
    args: { opId: 'w1', taskIds: [childId] },
  });
}

async function runCoordContinuation(sessionId: string | undefined, startId: number): Promise<void> {
  // MCP ask_user removed — continuation path reports progress then completes.
  const progress = await callTool(sessionId, startId, {
    tool: 'report_progress',
    args: { opId: 'p1', note: 'continuation after child_results' },
  });
  await callTool(progress.sessionId, progress.nextId, {
    tool: 'complete_task',
    args: { opId: 'c-cont', result: 'coord done after children' },
  });
}

async function main(): Promise<void> {
  const init = await mcpPost({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'bridge-tool-agent', version: '0.1.0' },
    },
  });
  if (init.status >= 400) {
    throw new Error(`initialize failed: ${init.status} ${JSON.stringify(init.json)}`);
  }
  if (init.json && typeof init.json === 'object' && 'error' in (init.json as object)) {
    throw new Error(`initialize JSON-RPC error: ${JSON.stringify(init.json)}`);
  }

  const sessionId = init.sessionId;
  const id = 2;

  if (scriptRaw === 'coord-initial') {
    await runCoordInitial(sessionId, id);
    return;
  }
  if (scriptRaw === 'coord-continuation') {
    await runCoordContinuation(sessionId, id);
    return;
  }

  const script = JSON.parse(scriptRaw) as ToolCall[];
  let nextId = id;
  for (const call of script) {
    const result = await callTool(sessionId, nextId, call);
    nextId = result.nextId;
    console.log(JSON.stringify({ tool: call.tool, result: result.json }));
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});