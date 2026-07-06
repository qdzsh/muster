<script lang="ts">
  import { thread, registerBackendSelect } from '../lib/turn-state.svelte';
  import { post } from '../lib/protocol';

  function newSession() {
    post({ type: 'newSession', backend: thread.backend });
  }

  // vscode-single-select dispatches input+change; bind:value keeps thread.backend in sync.
  let backendSelect: (HTMLElement & { value: string }) | undefined;

  function syncBackendFromSelect(e: Event) {
    const el = (e.currentTarget ?? backendSelect) as (HTMLElement & { value: string }) | undefined;
    const next = el?.value;
    if (next === 'claude' || next === 'grok') {
      thread.setBackend(next);
    }
  }

  $effect(() => {
    registerBackendSelect(backendSelect);
  });

  const shortId = $derived(thread.sessionId ? thread.sessionId.slice(0, 8) : null);
</script>

<div
  class="flex items-center gap-2 px-2 py-1 border-b"
  style="border-color: var(--vscode-panel-border);"
>
  <span class="font-semibold">Muster</span>

  <vscode-single-select
    bind:this={backendSelect}
    value={thread.backend}
    title="Backend"
    disabled={thread.running}
    onchange={syncBackendFromSelect}
    oninput={syncBackendFromSelect}
  >
    <vscode-option value="claude">Claude</vscode-option>
    <vscode-option value="grok">Grok</vscode-option>
  </vscode-single-select>

  {#if shortId}
    <vscode-badge title={thread.sessionId}>{shortId}</vscode-badge>
  {/if}

  <span class="flex-1"></span>

  {#if thread.running}
    <vscode-badge>running…</vscode-badge>
  {/if}

  <vscode-button secondary onclick={newSession}>New Session</vscode-button>
</div>