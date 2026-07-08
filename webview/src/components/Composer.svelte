<script lang="ts">
  import { threadStore } from '../lib/thread.svelte';
  import { tasks, resolveBackendForSend } from '../lib/tasks.svelte';
  import { post } from '../lib/protocol';
  import { getTaskStatusPresentation, isTaskStatusTerminal } from '../lib/task-status';
  import type { PendingAsk, TaskViewStatus } from '../lib/protocol';

  interface Props {
    mode: 'draft' | 'task';
    taskId?: string;
    turnId?: string | null;
    readOnly?: boolean;
    pendingAsk?: PendingAsk | null;
    taskStatus?: TaskViewStatus;
  }

  let {
    mode,
    taskId,
    turnId = null,
    readOnly = false,
    pendingAsk = null,
    taskStatus = 'idle',
  }: Props = $props();

  const thread = $derived(threadStore.current);
  const presentation = $derived(getTaskStatusPresentation(taskStatus));

  let textareaEl: (HTMLElement & { value: string }) | undefined;

  const statusBlocksSend = $derived(
    taskStatus === 'running' ||
      taskStatus === 'queued' ||
      taskStatus === 'waiting_user' ||
      taskStatus === 'needs_recovery' ||
      isTaskStatusTerminal(taskStatus),
  );
  const blocked = $derived(mode === 'task' && (!!pendingAsk || readOnly || statusBlocksSend));
  const canSend = $derived(mode === 'draft' ? !blocked : !thread.running && !blocked);
  const canCancel = $derived(mode === 'task' && taskStatus === 'running' && !!taskId && !!turnId);

  function send() {
    if (!canSend || !textareaEl) return;
    const value = (textareaEl.value ?? '').trim();
    if (!value) return;

    if (mode === 'draft') {
      const backend = resolveBackendForSend();
      tasks.setBackend(backend);
      const payload: {
        type: 'send';
        text: string;
        backend: string;
        continuationOf?: string;
      } = { type: 'send', text: value, backend };
      if (tasks.continuationOf) payload.continuationOf = tasks.continuationOf;
      threadStore.current.appendTranscript({
        id: `local-${Date.now()}`,
        kind: 'user',
        content: value,
      });
      post(payload);
    } else if (taskId) {
      post({ type: 'send', taskId, text: value });
    }

    textareaEl.value = '';
  }

  function cancel() {
    if (!canCancel || !taskId || !turnId) return;
    post({ type: 'cancelTurn', taskId, turnId });
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  const disabledReason = $derived.by(() => {
    if (mode === 'draft') return '';
    if (pendingAsk) return 'Answer the pending task question above to continue.';
    if (taskStatus === 'running') return presentation.composerGuidance;
    if (taskStatus === 'queued') return presentation.composerGuidance;
    if (taskStatus === 'waiting_user') return presentation.composerGuidance;
    if (taskStatus === 'needs_recovery') return presentation.composerGuidance;
    if (isTaskStatusTerminal(taskStatus)) return presentation.composerGuidance;
    if (readOnly) return 'This task is read-only right now.';
    return '';
  });

  const placeholder = $derived(
    mode === 'draft'
      ? `New task message (${tasks.selectedBackend})...`
      : disabledReason
        ? disabledReason
        : `Message task...`,
  );
</script>

<div class="composer-shell border-t p-2 flex flex-col gap-2" style="border-color: var(--vscode-panel-border);">
  {#if disabledReason}
    <div class="composer-guidance" role="note">{disabledReason}</div>
  {/if}

  <vscode-textarea
    bind:this={textareaEl}
    rows={3}
    placeholder={placeholder}
    disabled={!canSend}
    onkeydown={onKeydown}
    style="width: 100%;"
  ></vscode-textarea>

  <div class="flex gap-2 justify-end items-center">
    {#if canCancel}
      <vscode-button secondary onclick={cancel}>Cancel running task</vscode-button>
    {:else if canSend}
      <vscode-button onclick={send}>Send</vscode-button>
    {:else if taskStatus === 'queued' && turnId}
      <span class="task-muted text-xs">Queued turn is waiting to resume.</span>
    {:else if taskStatus === 'needs_recovery' && !turnId}
      <span class="task-muted text-xs">Recovery actions need a retryable turn.</span>
    {/if}
  </div>
</div>
