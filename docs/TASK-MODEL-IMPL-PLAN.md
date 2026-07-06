# Task Model — Implementation Plan

Grounded, phased plan to standardize the Muster codebase to the task-orchestration
model. This is the **HOW**; [`TASK-MANAGEMENT.md`](TASK-MANAGEMENT.md) is the
authoritative **WHAT** (domain, invariants, type sketches, coordinator protocol).
Section references like "§4.3" point at `TASK-MANAGEMENT.md` unless noted.

**Prime directive:** the extension must stay working at every phase. The literal
flat single-chat flow remains **executable** (behind a feature flag, via a host
compatibility adapter) through Phase D; **Phase E is the functional cutover** to
engine-only operation, followed by deletion of the dead modules. The task layer is
built additively *above* the existing adapter layer.

> **Design dependency surfaced by review (read before Phase C/E):** the authoritative
> model requires every root task to be a **coordinator** (§2.1, §14.1) and every task
> disposition to be **staged via MCP tools** (`complete_task`/`fail_task`/
> `wait_for_tasks`, §6.1/§8). A backend with `supportsMCP === false` — **today's Grok**
> — therefore has **no defined role** in the task model and cannot stage a
> disposition. This plan does **not** invent alternate roles or disposition
> semantics to hide that. See §9 "Open design dependency": it must be resolved in
> `TASK-MANAGEMENT.md` (or by a separate Grok-MCP adapter change), and that resolution
> is a **hard, blocking prerequisite to the Phase E cutover** — reaching one
> authoritative path requires it. This plan does **not** narrow the target to
> Claude-only on its own; that would be an owner-authorized scope change.

---

## 1. Current state (gap analysis)

Verified by reading the tree on 2026-07-06.

| Area | Today | Verdict |
|------|-------|---------|
| Adapter contract | `src/types.ts` — `NormalizedEvent`, `RunOptions`, `Backend`, `BackendCapabilities` | **Reuse unchanged.** Task layer sits above it. |
| Backends | `src/backends/claude.ts` (MCP-capable), `grok.ts` (**`supportsMCP:false`, ignores `mcpConfigPath`**), `index.ts` (`makeBackend`, `BACKEND_IDS`) | **Reuse unchanged.** `turnCompleted` = one CLI invocation succeeded (§3.1). Grok task participation is **blocked upstream** — see §9. |
| Runner | `src/runner.ts` — `runTurn(backend,opts)= yield* backend.run(opts)` | Reused; engine consumes this event stream. |
| Session persistence | `src/session-store.ts` flat `get/saveSessionId` + `extension.ts` inline `.muster-sessions.json` IO, per-backend `Map` | **Legacy.** Superseded by per-task `committedSessionId` (§10); deleted in Phase E. |
| Coordinator/host | `extension.ts` `MusterChatProvider`: one `_currentRun`, flat `_handleSend`, per-backend session keying, staged commit on `turnCompleted` | **Replaced** by `TaskEngine`; flat path kept **executable** behind a compatibility adapter through Phase D; cutover + deletion in Phase E. |
| Webview state | `webview/src/lib/turn-state.svelte.ts` single `ThreadState` (items/streaming/running/**runId**/sessionId/backend) | **Replaced** by per-task threads + task list (Phase D). |
| Webview protocol | `webview/src/lib/protocol.ts` — `runId`-keyed `turnStart/event/turnDone/turnError`; `send/newSession/cancelTurn` | New `taskId`+`turnId` protocol + `snapshot`/`taskUpdated` (§14.2); the legacy flat path is bridged into it by a host adapter until E. |
| Muster Bridge | `docs/MUSTER-BRIDGE.md` design only — **no MCP server / AskBridge exists** | **Built in Phase C1** (prerequisite for coordinator tools + `ask_user`). |
| Tests | **None.** No `test` script; no vitest/jest; glob for `*.{test,spec}.*` = 0 files | **Prerequisite:** install a runner + exclude tests from `tsc` before Phase A. |
| Task domain | Nonexistent — no task/turn/store/engine/coordinator | Built in Phases A–C. |

**Net:** the adapter/runner substrate is sound and reused; everything from the
coordinator up (host, persistence, bridge, webview) is added then cut over.

---

## 2. Guiding constraints

1. **Coexistence: the flat path stays executable until Phase E.** Through A–B the
   flat path runs unchanged. In Phase D the webview moves to the new
   `taskId`+`turnId` protocol, and the flat `_handleSend` path is kept **runnable
   behind a feature flag** via a host **compatibility adapter** that translates its
   `runId` events into the new protocol — so the single webview renders either
   source and the proven flat path remains a working fallback. **Phase E** performs
   the actual switch to engine-only and then deletes the dead modules. There is
   never a second, incompatible webview protocol live at once.
2. **Additive-first.** New code lives under `src/task/**`; the only Phase-A/B change
   to existing files is the test/`tsconfig` setup. Host wiring lands in D; deletion in E.
3. **Host is authoritative** (§9, §13). `TaskEngine` is the sole decider of task/turn
   transitions. `TaskStore` persists; adapters execute; neither decides outcomes.
4. **Reuse the adapter contract as-is.** No `NormalizedEvent`/`Backend` changes.
   `turnCompleted` completes a *turn*, never a *task* (§3.1).
5. **Do not invent domain semantics.** The plan implements the authoritative model as
   written; where a real backend cannot satisfy it (Grok/MCP, §9), the plan flags the
   gap for upstream resolution rather than inventing roles or dispositions.
6. **Pure core, imperative shell.** Transition/derived-status/dependency/capability
   logic are pure functions (testable without IO); `store.ts`/`engine.ts`/bridge own
   side effects.
7. **Local data hygiene.** `.muster-tasks.json` is gitignored and treated as
   potentially sensitive; corrupt files preserved, never overwritten (§12.1).

---

## 3. Prerequisite — test infrastructure (blocks Phase A)

Phase A's deliverables are *transition tests*, *derived-status tests*, *dependency
tests*, and *idempotency tests*; none can exist without a runner.

- Add **vitest** (aligns with the existing Vite 8 toolchain; node-env unit tests).
- `package.json` scripts: `"test": "vitest run"`, `"test:watch": "vitest"`.
- Config scoped to `src/**/*.test.ts` (node environment; the webview keeps its own
  build).
- **Keep tests out of the extension `tsc` emit.** `tsconfig.json` currently has
  `include: ["src/**/*", "scripts/**/*"]` and **no `exclude`**, so `tsc -p .` (via
  `npm run compile`) would compile and emit `*.test.ts` into `dist`. Add
  `"exclude": ["**/*.test.ts", "vitest.config.ts"]` to `tsconfig.json` (or move
  tests to a separate `test/` dir with its own tsconfig outside the emit). Required.
- Rationale: the engine is a state machine — correctness must be pinned by tests,
  per every phase checklist in §15.

---

## 4. Phases

Each phase is independently shippable and leaves the extension working.

### Phase A — Domain types + pure logic + tests  *(additive; zero runtime wiring)*

**Add**
- `src/task/types.ts` — mirror the §4 / §9 / §12.1 sketches verbatim in intent:
  `TaskRole` (`coordinator` | `worker` only — no invented roles), `TaskLifecycleState`,
  `TaskDependency`, `PersistedWait`, `TaskCapability`, `TaskExecutionPolicy`,
  `MusterTask`; `TurnStatus`, `TurnTrigger`, `TurnInput`, `TurnDisposition`,
  `TaskTurn`; `TaskMessageState`, `TaskMessage`; `TaskStoreFile` envelope;
  `TaskViewStatus`.
- `src/task/derived-status.ts` — pure `deriveViewStatus(task, turns, deps)` per the
  **deterministic order in §4.3** (terminal → live turn → unsatisfied deps → queued
  → children wait → external block → needs-recovery → idle).
- `src/task/transitions.ts` — pure guards/reducers returning `{next, effects}` (no
  IO) for create/queue-turn/start/complete/fail/wait/interrupt/retry/cancel;
  disposition staged→committed-on-success/discarded-on-failure; idempotency keys
  from `(turnId, toolCallId)` / operation IDs.
- `src/task/deps.ts` — pure dependency-graph validation (§5.1, §7): cycle detection,
  same-root scope enforcement, `onUnsatisfied` evaluation, and rejection of any
  dependency change after the first turn is queued (immutability). Typed
  accept/reject; enforced by the engine in B/C.
- `src/task/backend-eligibility.ts` — pure predicate `canBindTaskToBackend(caps)`:
  a task may bind to a backend **only if that backend can satisfy the authoritative
  protocol** (today: `supportsMCP === true`, since roots are coordinators and
  dispositions are MCP-staged). This is a truthful capability guard, **not** a new
  role. It is the mechanism that keeps a non-MCP backend (Grok) out of the task model
  until §9 is resolved. (Host-issued capability *sets* per role are added in C2.)

**Test (vitest)**
- `derived-status.test.ts` — every branch + precedence of §4.3.
- `transitions.test.ts` — every task/turn op; invariants §3.
- `deps.test.ts` — cycle rejection, cross-root rejection, post-queue mutation
  rejection, each `onUnsatisfied` outcome.
- `backend-eligibility.test.ts` — MCP backend accepted; non-MCP backend rejected.
- `idempotency.test.ts` — duplicate child-completion + continuation collapse to one effect.

**Exit:** `npm test` green; `npm run compile` green; no existing file changed.

### Phase B — Versioned `TaskStore` + single-task `TaskEngine`  *(headless)*

**Add**
- `src/task/store.ts` — `TaskStoreFile` IO: atomic replace (temp + `rename`),
  `schemaVersion`+`revision`, single-writer / compare-and-swap guard across VS Code
  windows, corrupt-file preservation, explicit versioned migration hook, derived
  index rebuild (§12.1).
- `src/task/session-select.ts` — backend-specific committed-id selection (§10.1)
  reusing `Backend.extractSessionId`.
- `src/task/engine.ts` — `TaskEngine` for one task/session, multiple turns:
  `createTask` (rejects a backend failing `canBindTaskToBackend`; validates
  `deps.ts` guards when dependencies are supplied) / `startTask` / `continueTask` /
  `interruptTurn` / `retryTurn` / `cancelTask`; consumes `runTurn(backend, opts)`
  and maps each `NormalizedEvent` to turn/task transitions; commits session id
  **only** on `turnCompleted` (§10); applies staged disposition on success, discards
  on fail/interrupt (§6.1); reload reconciliation (§12.2: running/waiting_user →
  interrupted, no auto-replay).
- **Durable message lifecycle owned by the engine (§9, §6.1).** `send(taskId,
  message)` persists a `pending` user `TaskMessage`. Immediately before a queued
  turn spawns, eligible pending messages are **atomically assigned** to that turn
  (write `TurnInput` + flip state to `assigned`, persisted together). Assistant
  output is persisted `partial` while streaming, flipped to `complete` on successful
  settlement. On failure/interrupt, messages and the turn stay inspectable, never
  silently deleted or reassigned. `send` lives in **Phase B** (not D) so it is
  testable headless.

**Test** — fake-backend `NormalizedEvent` streams: success→commit; error→no-commit +
`needs_recovery`; interrupt→immutable interrupted turn; reload marks in-flight
interrupted and never respawns. Message tests: pending survives queued/running/
waiting; atomic assignment once before spawn; assistant `partial`→`complete`;
failure inspectability. Eligibility test: `createTask` rejects a non-MCP backend.

**Exit:** engine+store+messages verified headless (`scripts/test-task.ts`, mirroring
`test-grok.ts`); flat chat untouched.

### Phase C — Muster Bridge + coordinator orchestration  *(largest; long pole)*

Two parts; C1 builds the infrastructure C2 and `ask_user` require. This phase gets
its **own detailed sub-plan + codex-plan-review** when reached.

**C1 — Muster Bridge (MCP transport) — prerequisite infrastructure (§8.4, `MUSTER-BRIDGE.md`)**
- Production MCP server lifecycle (starts/stops with the extension; one endpoint the
  spawned CLI connects to) + **`AskBridge`** (pending asks, in-memory, keyed by task/turn).
- **Per-turn `mcpConfigPath` injection** into `RunOptions` for MCP-capable backends so
  a turn's process is handed exactly its scoped tools.
- **Short-lived per-turn credential** issue + **verification on every tool call**
  (root/caller/turn/allowed-actions/expiry); tool-list filtering is prompting only,
  not the authorization boundary.
- Cancellation/reload cleanup: cancel in-memory asks for interrupted/reloaded turns
  (§12.2); a dead process's answer never resumes it.
- Webview ↔ host **ask routing** (`askPending` out, `submitAsk` in) wired to `AskBridge`.

**C2 — Coordinator tools + orchestration (on top of C1)**
- `src/task/coordinator-tools.ts` — handlers for `create_task`, `delegate_task`,
  `start_task`, `interrupt_task`, `cancel_task`, `wait_for_tasks`, `get_task_status`,
  `complete_task`, `fail_task`, `report_progress`, `ask_user` (§8.1). Tools **stage**
  requested actions; the engine validates ownership / capability / state / limits.
- `src/task/capabilities.ts` — host-issued capability *sets* per role (§4.1, §8.4);
  callers cannot self-grant. (Builds on Phase A's `backend-eligibility.ts`.)
- Engine enforcement of the `deps.ts` guards (§5.1/§7), child wait barriers (§8.2),
  bounded retries, resource limits, and per-task/session serialization (§11).

**Test** — capability rejection; a real MCP-capable backend (Claude) driving
`complete_task`/`wait_for_tasks`/`ask_user` **end-to-end through the live Bridge**;
`wait_for_tasks` barrier → single continuation; child failure
settles-but-doesn't-fail-parent (§8.3); idempotent continuation under races/reload;
wrong-caller / expired-credential rejection; limit enforcement.

**Exit:** a CLI turn calls orchestration + `ask_user` tools end-to-end through the
real Bridge — **not headless-only**.

### Phase D — Webview: task UI + `taskId`/`turnId` protocol  *(flat path stays executable)*

The webview moves to a **single** protocol (new identity model). The flat path is
**not** removed here — it stays runnable behind a flag via a host compatibility
adapter, so coexistence holds until Phase E.

**Change / add**
- `webview/src/lib/protocol.ts` — every turn-scoped message carries `taskId`+`turnId`
  (rename `runId`→`turnId`); add `taskUpdated {taskId, revision, patch}` and
  `submitAsk {taskId, turnId, askId}` (§14.2). Add a **hydration handshake**: on
  webview open/activation the host sends a `snapshot` = **root task list + the focused
  task's persisted subtree summaries + the focused task's transcript**, rebuilt from
  `TaskStore`; then incremental `taskUpdated`. Focusing another task may issue a
  `hydrateSubtree {taskId}` request answered with that subtree (§12, §14).
- `src/extension.ts` — a **host compatibility adapter**: when the legacy flag is on,
  the existing flat `_handleSend` keeps running and its `runId` events are translated
  into the new protocol (a synthetic implicit task/turn) so the single webview
  renders them. When off (default), messages route through `TaskEngine`:
  first message creates the root task and queues its first turn (§14.1);
  `send(taskId, message)` (Phase B) targets the focused task (§9).
- Webview state — replace the single `ThreadState` with a **task list store** + a
  **per-task thread** model hydrated from the `snapshot` (incl. subtree); derive view
  status; **ignore late events** whose `turnId` is no longer active for that task.
- Components — **Task list** (root tasks, continuation grouping, derived status,
  **New task**), **Task workspace** (subtree + focused task's session thread), child
  `ask_user` interaction, **Continue as new task** (§14).

**Test** — **coexistence:** with the legacy flag ON, flat chat (send/stream/cancel/
new-session/resume) works through the compatibility adapter and renders in the new
webview; with it OFF, the engine path works. **Reload/hydration:** reopening the
webview reconstructs the task list **and a focused task's existing child subtree** +
transcript from `TaskStore`. Plus reducer/derived-status units, protocol type checks,
vite build green.

**Exit:** task UI usable end-to-end for a task; flat chat still executable behind the
flag; nothing deleted yet.

### Phase E — Cutover, migration & cleanup  *(hard-gated on §9)*

- **Entry prerequisite (blocking):** §9 must be **resolved first** — one of its two
  admissible resolutions *completed*, giving **every shipping backend (Claude and
  Grok) a viable task path**. Phase E does not begin until then. This is precisely
  what lets the cutover reach a *single* authoritative path instead of leaving two
  models. (Narrowing the target to a Claude-only task model is an owner-authorized
  scope change, decided outside this plan — not a Phase-E option chosen here.)
- **Cutover:** make the engine path the default and remove the legacy flag +
  compatibility adapter — the functional switch the earlier phases deferred.
- Migrate legacy `.muster-sessions.json` (adopt as an initial task per backend, or
  archive — **not** silently dropped); add retention/pruning + recovery UI (§12);
  **delete** all now-dead flat modules (`_handleSend`, per-backend `Map`,
  `src/session-store.ts`, the old `runId` `ThreadState`, and the compatibility
  adapter); update `README.md`/`DESIGN.md` status.

**Exit:** the engine is the *only* path; **all** shipping backends run on the task
model; the flat path and compatibility adapter are fully deleted; docs updated.

---

## 5. Sequencing, review gates, delegation

- Per phase: *(detailed sub-plan for C)* → implement → `npm test` + `npm run compile`
  green → **codex-impl-review (working-tree)** → apply/dispute → APPROVE → optional commit.
- **Delegation:** Phases A and B are pure/headless with tight acceptance criteria →
  good candidates to hand to Grok (as with the adapter). Phases C and D need more
  design judgment; keep closer.
- **Recommended order:** A → B → **D** (task UI; flat path still executable) → C
  (bridge + coordinator) → E (cutover). Ships a usable task UI with a working flat
  fallback before the long-pole bridge/coordinator work; cutover happens last.

---

## 6. Risks & open items

1. **Bridge is the long pole** — coordinator orchestration and `ask_user` cannot work
   until **Phase C1** builds the Muster Bridge (server + `AskBridge` + per-turn
   `mcpConfigPath` + credential verification + ask routing). Scheduled as C1, not
   assumed. Sequence A/B/D first; give C its own plan-review.
2. **Cross-window store races** — the JSON store needs real CAS or a single-writer
   lock; naive `writeFileSync` loses updates across two VS Code windows. Decide in Phase B.
3. **Scope size** — multi-session work. The flat path stays **executable** through D
   (A/B unchanged, D behind a compat adapter); the cutover + deletion is Phase E.
4. **No tests today** — Phase A is blocked on the vitest + `tsconfig` exclude in §3.
5. **`runId`→`turnId` rename** lands in Phase D on the new path; the flat path keeps
   working via the host compatibility adapter (translation), so the rename never
   produces a broken intermediate. Deletion is deferred to Phase E.
6. **Grok cannot satisfy the task model (open upstream dependency, §9)** — resolving
   it is a **blocking prerequisite to the Phase E cutover**; the choice of resolution
   (extend `TASK-MANAGEMENT.md` vs. add Grok-MCP support) is escalated to the owner,
   not decided inside this plan.

---

## 7. Files by phase (summary)

| Phase | Add | Change |
|-------|-----|--------|
| Pre | `vitest.config.ts` | `package.json` (test scripts, devDep); `tsconfig.json` (`exclude` tests) |
| A | `src/task/{types,derived-status,transitions,deps,backend-eligibility}.ts` + `*.test.ts` | — |
| B | `src/task/{store,engine,session-select}.ts` (engine owns `send` + `TaskMessage`) + tests; `scripts/test-task.ts` | `package.json` (mvp:task) |
| C1 | Muster Bridge: MCP server + `AskBridge` + per-turn credential issue/verify | `src/extension.ts` (bridge lifecycle); `RunOptions` `mcpConfigPath` wiring |
| C2 | `src/task/{coordinator-tools,capabilities}.ts` + tests | `src/task/engine.ts` (deps enforcement, barriers, limits) |
| D | task-list/workspace components; per-task state store; `snapshot`(+subtree)/hydrate handshake; host compatibility adapter | `webview/src/lib/protocol.ts`, `src/extension.ts` (flag: flat-vs-engine) |
| E *(gated on §9)* | migration + retention/recovery UI | remove flag + compat adapter; delete **all** flat modules; `README.md`, `docs/DESIGN.md` |

---

## 8. References

- [`TASK-MANAGEMENT.md`](TASK-MANAGEMENT.md) — authoritative domain model & protocol
- [`ADAPTER-SPEC.md`](ADAPTER-SPEC.md) — exactly-one-terminal-event adapter contract (reused)
- [`SESSION-MANAGEMENT.md`](SESSION-MANAGEMENT.md) — backend session identity & resume fallback (§10)
- [`MUSTER-BRIDGE.md`](MUSTER-BRIDGE.md) — MCP transport, AskBridge, bridge security (Phase C1)
- [`WEBVIEW.md`](WEBVIEW.md) — rendering & postMessage protocol (Phase D)
- [`DESIGN.md`](DESIGN.md) — per-turn process architecture

---

## 9. Open design dependency — non-MCP backends (Grok) in the task model

**Status: unresolved; owned by `TASK-MANAGEMENT.md`, not closed by this plan.**

The authoritative model requires every root task to be a **coordinator** (§2.1,
§14.1) and every task disposition to be **staged via MCP tools** (`complete_task`,
`fail_task`, `wait_for_tasks`; §6.1, §8). Today's `GrokBackend` has
`supportsMCP: false` and its `run()` ignores `RunOptions.mcpConfigPath`, so a
Grok-bound turn can call **no** task tools:

- a Grok **root/coordinator** cannot orchestrate or self-dispose; and
- a Grok **worker** cannot report `complete`/`fail`, so its task never reaches a
  terminal outcome through the prescribed protocol (the §6.1 fallback is `idle`,
  which is non-terminal and would never settle a parent's wait barrier).

This plan will **not** invent a `single-task` role or a host/UI disposition path to
mask the gap (doing so contradicts the authoritative `TaskRole` and §6.1). Resolution
must come from one of:

1. **Extend `TASK-MANAGEMENT.md`** (its owner) to define how a non-MCP backend
   participates — e.g. a sanctioned host-derived disposition for adapter
   `turnCompleted`/`error` on non-MCP worker turns, or an explicit "MCP-required"
   backend policy that excludes such backends by design.
2. **A separate Grok-MCP adapter change** (outside this plan's "reuse the adapter
   unchanged" constraint) that adds MCP support to `grok.ts`, after verifying the grok
   CLI actually supports an MCP config.

Through Phases A–D, `canBindTaskToBackend` keeps Grok out of the task model and Grok
chat continues on the flat/compatibility path. **Resolving this dependency is a hard,
blocking prerequisite to the Phase E cutover:** Phase E does not begin until one of
{1, 2} is completed, so the cutover yields a *single* authoritative task path covering
both backends. Narrowing the target to a "Claude-only task model" is a scope change
that only the project owner can authorize — this plan does **not** assume it; absent
that authorization, resolution path 1 or 2 is required before Phase E.
