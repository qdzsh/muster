# Plan: Close plan gaps — remove legacy / dead code / tech debt

**Status:** PARTIAL (2026-07-15) — C0–C3 landed; C4/C5 residuals + CI compile/check:svelte in progress (impl-review r1).  
**Session:** `.codex-review/sessions/codex-plan-review-20260715-002`  
**Date:** 2026-07-15  
**Goal:** Features in APPROVED plans are already largely on `main`. This plan does **not** re-implement them. It **audits AC**, **deletes dead product paths**, **renames misleading APIs**, **updates plan status only after evidence**, and **closes only real residuals**.

---

## Diagnosis

| Plan doc | Doc status | Code reality | Action |
|----------|------------|--------------|--------|
| `interrupt-and-send-queue-refactor.md` | APPROVED | Product path = `interruptAndSend`; extension `sendLiveInput` → reserve+interrupt | **Audit first**; IMPLEMENTED only if AC pass **and** concurrent inject deleted (C1) |
| `task-chat-turn-hide-cli.md` (A/B/C) | APPROVED | `turn-activity`, host `currentTurnActivity`, outbox + `clientRequestId` + `dispatchPhase` present | **Audit first**; delete `cli-status`; settle recovery fallback (C2) |
| `task-orchestration-auto-run.md` (W1–W9) | APPROVED | brief/dataflow/readiness/resources/release/sealedBy/attention/trust/`bridgeTokenTtlMs` present | **Audit first**; MCP hygiene + trust/TTL/reload verify (C3) |
| `rfd-elicitation-full.md` | (no status) | form+url caps, bridge, cards, `-32042`, complete | **Audit AC 1–13**; residual only (C4) |
| `delegate-task-ux-improve.md` | APPROVED | P0–P2 shipped on `main` | **Audit**; residuals C5 then IMPLEMENTED |

**Root cause of “plans still open”:** plan files were never flipped after landing; concurrent live-inject was superseded but not deleted.

---

## Non-goals

- New product features (yolo root seal, live `continue_child` queue, Antigravity backend, named `outputs` beyond summary)
- Full protocol rename of every historical type in one PR if it blocks ship (prefer phased renames with tests green)
- Re-enable MCP `ask_user` (stays disabled; remove from catalog + docs that claim it is active)
- Invent ACP `session/resume`
- Broad UI redesign beyond vocabulary leftovers

---

## Status transition rules (ISSUE-1)

**Never** mark a source plan IMPLEMENTED in C0 alone.

| Status | When |
|--------|------|
| **PARTIAL** | Evidence audit done; ≥1 residual open; link residual to this plan section (C1–C5) |
| **IMPLEMENTED** | All applicable AC pass **and** every residual linked from that plan is closed **and** release gate (below) is green under **Node 24** |

**C0** = evidence audit + PARTIAL/residual ledger only.  
**Final IMPLEMENTED** = after C1–C5 (as needed) + C6 + release gate.

---

## Workstreams

### C0 — Evidence audit + residual ledger (docs first, no false IMPLEMENTED)

For each plan in the diagnosis table:

1. Walk AC / checkboxes against code + tests. Record evidence (test name, file:line, or “missing”).
2. Tick only boxes that pass with evidence.
3. For any fail/unknown: add a residual row here (or under C1–C5) with owner slice.
4. Set source plan status to **PARTIAL** + date + link to this plan’s residual section — **not** IMPLEMENTED yet.
5. Update `docs/README.md` so shipped-but-residual plans say PARTIAL / cleanup-in-progress, not “ready for implementation”.

#### C0 evidence snapshot (2026-07-15)

| Plan | Landed evidence | Residual owner |
|------|-----------------|----------------|
| interrupt & send | `engine.interruptAndSend`; extension case → interrupt only | **C1** concurrent inject stack |
| hide-CLI | `turn-activity.ts`, outbox, `dispatchPhase`, host activity field | **C2** cli-status + client recovery derive |
| orchestration auto-run | brief/dataflow/readiness/resources/limits TTL/trust hooks | **C3** MCP catalog + docs ask_user |
| RFD elicitation | elicitation.ts, ElicitationBridge, form+url caps, -32042 | **C4** AC tick / real miss |
| delegate UX | waitForCompletion, ask_parent, continue_child, cancel_tasks | **C5** cancel/Q + dep wake |

**AC**

- [x] All five plans audited with evidence notes
- [x] No source plan marked IMPLEMENTED before residuals + release gate (all **PARTIAL**)
- [x] Single residual backlog lives in this file (sections C1–C5)
- [x] `docs/README.md` index matches PARTIAL/cleanup state

---

### C1 — Kill concurrent live-inject (dead product path)

**Product truth today:** composer Ctrl/Cmd+Enter → host OutMessage `sendLiveInput` → `TaskEngine.interruptAndSend` only. Never concurrent ACP inject, never host `liveInputResult` banner.

**Disposition inventory (complete — do not ship C1 with leftovers):**

| Artifact | Role | Disposition |
|----------|------|-------------|
| `src/host/live-input.ts` + `live-input.test.ts` | `routeSendLiveInput` concurrent inject router | **Delete** |
| `extension.ts` unused `routeSendLiveInput` import | Dead import | **Delete** |
| `TaskEngine.sendLiveInput` | Concurrent inject to running turn | **Delete** |
| `Backend.sendLiveInput` + `LiveInputRequest` / `LiveInputResult` product types | Wire concurrent inject | **Delete** from product surface (`src/types.ts` + adapters) |
| `supportsLiveInput` capability flag | Advertises concurrent inject | **Delete** if only used for inject |
| `src/backends/acp-client.ts` `sendLiveInput` + live-input capability evidence | Wire | **Delete** concurrent path |
| `src/backends/acp-run.ts` live-input route helpers | Wire | **Delete** |
| All adapters (`claude`/`codex`/`grok`/`kiro`/`opencode`) `sendLiveInput` methods | Wire | **Delete** |
| `acp-test-harness` live-input fakes | Test support for inject | **Delete** inject-only harness surface |
| Webview `liveInputResult` + `formatLiveInputDeliveredMessage` + App handler | Banner | **Delete** |
| Protocol `delivery?: 'turn' \| 'live_inject'` union + validators accepting `live_inject` | Typed inject delivery | **Delete** `live_inject` from union/validators entirely (only `'turn'` or omit field) |
| `insertLiveInject` + recognition of `{ muster: 'live_inject' }` in thread | Mid-stream inject UI | **Delete** method + marker branch |
| Historical raw transcript lines with inject markers | Old sessions | **Generic ignore-unknown raw** only — no special-case inject parser left |
| `LiveInputRequest` / `LiveInputResult` types | Concurrent inject API types | **Delete** from product types |
| `scripts/*` / `package.json` scripts for live-inject smoke | Product/dev path for concurrent inject | **Delete or rewrite** to interrupt&send-only if still needed |
| Docs (non-plan): WEBVIEW/TASK-MANAGEMENT claims of concurrent inject / “live input delivered” | Misleading product docs | **Rewrite** to interrupt&send |
| Tests asserting concurrent inject product behavior | — | Rewrite to interrupt&send; delete inject-only suites |

**Retained (do not delete):**

- OutMessage type name `sendLiveInput` (C1a) → host maps to `interruptAndSend`
- `TaskEngine.interruptAndSend` + reserve-then-interrupt semantics
- Security test: extension case wires interrupt&send, not `engine.sendLiveInput`
- Generic unknown-raw tolerance in thread (no inject-specific recognition)

**Rename (C1b, after C1a green):** OutMessage `sendLiveInput` → `interruptAndSend` across protocol + webview + extension + tests.

**Grep / repo gates (whole tree `src` `webview` `scripts` `package.json`; docs except historical plan text):**

Forbidden after C1 in `src` `webview` `scripts` `package.json` (and non-plan product docs) — must be empty except allowlist below:

- `routeSendLiveInput`
- `liveInputResult`
- `live_inject` / `insertLiveInject`
- `LiveInputRequest` / `LiveInputResult`
- `Backend.sendLiveInput` / `engine.sendLiveInput` / adapter method `sendLiveInput(`
- `supportsLiveInput`

**Allowlist only:**

- Historical plan prose under `docs/plans/*` labeled superseded / pre-cleanup
- Wire OutMessage / composer intent name `sendLiveInput` until C1b rename (interrupt&send only)
- Comments that say “never concurrent …” if still needed briefly

**AC**

- [x] No production call path reaches concurrent inject
- [x] Extension `sendLiveInput` case only calls `interruptAndSend`
- [x] No `liveInputResult` posted or handled; no `insertLiveInject` / typed `live_inject` delivery
- [x] Whole-tree grep gates above pass (allowlist-only exceptions; smoke scripts assert absences)
- [x] Historical raw inject markers: ignored as unknown raw, no crash, no inject UI path
- [x] `npm test` 1285 pass; `compile`; `check:svelte` 0 errors; `test:webview` 30 pass (local Node 26; CI Node 24 still required at C6)
- [x] Security test still asserts interrupt&send wiring

---

### C2 — Hide-CLI leftovers

| Item | Disposition |
|------|-------------|
| `webview/src/lib/cli-status.ts` + `cli-status.test.ts` | **Delete** |
| Composer / TaskList / recovery copy still saying “CLI” | Grep + rewrite to Task/Turn vocabulary |
| Dual recovery path (`needs_recovery` when host omits `currentTurnActivity`) | **Settled contract (ISSUE-4):** host **always** projects `currentTurnActivity` on task summaries after snapshot apply. **Absent key → neutral/loading chrome only** (or hard incompatible-snapshot reject if we choose fail-closed for post-handshake snapshots). **Never** client-derive `failed_turn` / `uncertain` / recovery buttons from raw `runtime` / `needs_recovery` / `viewStatus`. Delete code paths that map `needs_recovery` → recovery chrome without host activity. |
| Phase C ack/outbox | **Already landed** — verify AC, do not re-implement |

**AC**

- [x] No UI import of `cli-status` (module deleted)
- [x] User-visible strings: no “CLI running/stopped/idle” product chrome
- [x] Recovery chrome only when host `currentTurnActivity.state` is `uncertain` or `failed_turn`
- [x] Snapshot projects `currentTurnActivity` (`src/host/snapshot.ts` + tests)
- [x] Test: missing `currentTurnActivity` key does **not** synthesize recovery chrome (`turn-activity.test.ts`)

---

### C3 — Orchestration / MCP surface hygiene

#### C3.1 `start_task` — two APIs (ISSUE-3)

Do **not** conflate:

| API | Layer | Intent |
|-----|--------|--------|
| **A. Host** `TaskEngine.startTask` / recovery promote | Host-only | May remain for recovery if still called from extension/engine |
| **B. Coordinator MCP tool** `start_task` | MCP catalog + credential `allowedActions` + `coordinator-tools` parse + `engine-graph` `case 'start_task'` | Must **not** be agent-callable |

**Required procedure before deleting/retaining graph case:**

1. `rg` all non-test callers of graph command `kind: 'start_task'` and MCP tool name `start_task`.
2. If **no non-MCP host caller** needs the graph command: remove as **one slice** — `ALL_TOOLS`, `TOOL_INPUT_SCHEMAS`, parse arm, capability token, `engine-graph` case, obsolete tests.
3. If host recovery still needs start: keep **only** `TaskEngine.startTask` (or equivalent host method); do **not** expose MCP schema; graph command stays internal or is inlined into host path.

#### C3.2 `ask_user` MCP

- **Remove from MCP catalog** (prefer absent over disabled stub).
- Graph/engine may keep a hard reject only if needed for old credentials mid-turn; prefer full removal if credentials never re-issue `ask_user`.
- **Docs inventory (ISSUE-6)** — update every authoritative claim that MCP `ask_user` is an active product path:

  | Doc / surface | Expected after cleanup |
  |----------------|------------------------|
  | `README.md` feature table | MCP ask_user not “✅ active product”; point to ACP elicitation / ask_parent |
  | `docs/README.md` | Same |
  | `docs/MUSTER-BRIDGE.md` | State disabled/removed; RFD elicitation + Grok vendor path remain |
  | `docs/MCP-INJECTION.md` / tool catalog sections | No `ask_user` as available coordinator tool |
  | `docs/TASK-MANAGEMENT.md` | Coordinator asks via ACP elicitation (root) / `ask_parent` (child) |
  | Bridge tool descriptions / host-context playbook | No “use ask_user” |

  Supported ask paths after cleanup: **ACP RFD elicitation** (form/url), **Grok vendor** `x.ai/ask_user_question` → AskCard, **`ask_parent`** for non-root.

#### C3.3 W8/W9 verify (behavior fix only if audit fails)

- Tool descriptions: create/release/wait/status match playbook
- `bridgeTokenTtlMs`: confirm test token covers `turnTimeoutMs`
- Workspace trust: all release / delegate / startNewTask / promote paths refuse `workspace_untrusted`
- Reload: W9 table vs `deferReloadQueuedTurns`; fix only if diverges

**AC**

- [x] MCP tool list has no `start_task` and no `ask_user` (`src/bridge/server.ts` ALL_TOOLS)
- [x] Host `TaskEngine.startTask` retained for tests/recovery; not MCP-listed
- [x] Docs inventory: README, MCP-INJECTION, MUSTER-BRIDGE status note, TASK-MANAGEMENT pointer
- [x] Capabilities no longer grant MCP `ask_user` (root uses ACP elicitation)
- [x] Trust + `bridgeTokenTtlMs` already covered by existing engine/limits tests (no divergence found this pass)
- [x] `npm test` 1275 pass after C3

---

### C4 — RFD elicitation residuals

Do **not** rebuild. Only:

1. Walk AC 1–13 in `rfd-elicitation-full.md` against code/tests; check boxes with evidence.
2. Fix any real miss (dual-scope reject, OOB complete clear, etc.).
3. Confirm Grok vendor path still separate; MCP ask off (C3).

**AC**

- [ ] Plan AC checklist complete or residual filed under this plan
- [ ] `elicitation` form+url advertised; no hard-decline URL mode

---

### C5 — Delegate UX residuals (from ship review)

| Residual | Fix |
|----------|-----|
| Remote cancel + pending parent-Q cleanup | `clearPendingParentQuestionOnCancel` on local cancel, `processCancelRequests`, host `cancelTask`, parent-seal cancel |
| Sync wake after `dependency_unsatisfied` | `applyDependencyTerminals` in `afterTurnSettled` + post-settle queue scan |

**AC**

- [x] Cancelled subtree never leaves orphan parent `child_question` attention for cancelled Q (`engine-graph.test.ts` cancel_tasks + cancelTask)
- [x] `dependency_unsatisfied` visible on status/attention without hang (`engine.test.ts` C5 block-policy)

---

### C6 — Final ledger + dead code sweep

After C1–C5:

1. Flip each source plan **IMPLEMENTED** only if status rules satisfied.
2. Update `docs/README.md` final statuses.
3. `rg` `TODO|FIXME|@deprecated` in `src/` `webview/` — resolve or file.
4. Remove unused exports/imports; orphan testkits for deleted APIs.
5. `npm run test:source-boundary` green.
6. No drive-by comments.

---

## Suggested ship order

```text
C0   Evidence audit + PARTIAL ledger (no false IMPLEMENTED)
C1a  Delete concurrent live-inject stack (full inventory)
C2   cli-status + host-authoritative TurnActivity
C3   MCP start_task/ask_user + docs inventory + trust/TTL
C4   RFD AC close
C5   Delegate residuals
C1b  Optional rename sendLiveInput → interruptAndSend
C6   Final IMPLEMENTED flips + rg/lint sweep
```

Each slice: TDD where behavior changes → implement → release-gate subset → impl-review if multi-file.

---

## Verification (release gate)

**Mandatory environment:** **Node 24** (match `.github/workflows/ci.yml`). Run locally with Node 24 or via the same CI job; do **not** finalize plan IMPLEMENTED on a different major.

**Mandatory commands:**

```bash
node -v   # must be v24.x
npm test
npm run test:source-boundary
npm run test:evidence
npm run test:source-boundary:fixtures
npm run test:settings-docs
npm run compile
npm run check:svelte    # mandatory (ISSUE-5) — not optional
npm run test:webview
```

CI must include the same set (add `check:svelte` to workflow if missing before calling cleanup done).

**Grep gates (must be empty in product trees; historical plan prose OK under `docs/plans/` only if labeled superseded):**

```bash
# concurrent inject dead (allowlist: docs/plans historical prose; wire name sendLiveInput until C1b)
rg -n "routeSendLiveInput|liveInputResult|live_inject|insertLiveInject|LiveInputRequest|LiveInputResult|supportsLiveInput" src webview scripts package.json

# cli vocabulary
rg -n "from ['\"].*cli-status|CLI running|CLI stopped|CLI idle" webview/src

# MCP ask_user claimed active (spot-check; allow "disabled|removed")
rg -n "ask_user" README.md docs/README.md docs/MUSTER-BRIDGE.md docs/MCP-INJECTION.md docs/TASK-MANAGEMENT.md
```

---

## Risk notes

- **Historical store / chat transcripts** may contain old `live_inject` markers → thread parser **ignore unknown**, not crash.
- **Backend interface change** (`sendLiveInput` removal) touches every adapter — one atomic PR with tests.
- **MCP tool removal** is a wire break for external clients listing them — acceptable; docs must not claim they remain available.
- Do **not** delete `interruptAndSend` or RFD bridge while grepping “live”.
- **Status honesty:** PARTIAL mid-cleanup beats false IMPLEMENTED.

---

## Confidence

**High** concurrent inject + cli-status are pure debt.  
**Medium** W9 reload auto-resume matches plan table without a behavior fix.  
**High** plan status docs are the main source of “still open” confusion.

---

## Out of scope follow-ups (explicit)

- Root `coordinator_delegate` / yolo
- Live-child FIFO `continue_child`
- Generation-aware multi-epoch waits
- Named complete_task outputs map (v1.1)
- Antigravity backend
)
