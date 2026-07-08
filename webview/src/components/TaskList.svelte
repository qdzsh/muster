<script lang="ts">
  import { tasks } from '../lib/tasks.svelte';
  import { post } from '../lib/protocol';
  import { getTaskStatusPresentation, isTaskStatusTerminal } from '../lib/task-status';
  import type { TaskSummary, TaskViewStatus } from '../lib/protocol';

  function selectTask(taskId: string) {
    tasks.focusTask(taskId);
    post({ type: 'focusTask', taskId });
    post({ type: 'hydrateSubtree', taskId });
  }

  function newTask() {
    tasks.openNewTaskDraft();
    post({ type: 'newTask' });
  }

  function shortGoal(goal: string): string {
    const trimmed = goal.trim();
    if (trimmed.length <= 48) return trimmed || '(no goal)';
    return `${trimmed.slice(0, 45)}...`;
  }

  function statusClass(status: TaskViewStatus): string {
    return `task-status task-status--${getTaskStatusPresentation(status).tone}`;
  }

  function taskStateFlags(task: TaskSummary): string[] {
    const flags: string[] = [];
    if (task.viewStatus === 'running') flags.push('Active turn');
    if (task.viewStatus === 'queued') flags.push('Queued turn');
    if (task.viewStatus === 'waiting_user') flags.push('Waiting for answer');
    if (task.viewStatus === 'needs_recovery') flags.push('Recovery needed');
    if (task.viewStatus === 'failed') flags.push('Failed terminal task');
    if (task.viewStatus === 'cancelled') flags.push('Cancelled terminal task');
    if (isTaskStatusTerminal(task.viewStatus) && task.viewStatus !== 'failed' && task.viewStatus !== 'cancelled') {
      flags.push('Terminal task');
    }
    if (task.continuationOf) flags.push('Continuation');
    return flags;
  }

  function taskAriaLabel(task: TaskSummary): string {
    const presentation = getTaskStatusPresentation(task.viewStatus);
    const flags = taskStateFlags(task);
    return [shortGoal(task.goal), presentation.label, presentation.listCopy, ...flags].join(' ');
  }

  function itemClass(task: TaskSummary): string {
    const classes = ['task-list-item', 'w-full', 'text-left', 'rounded', 'px-2', 'py-1.5', 'text-xs', 'flex', 'flex-col', 'gap-1'];
    if (tasks.focusedTaskId === task.id && !tasks.draftMode) classes.push('selected', 'task-list-item--selected');
    if (task.viewStatus === 'running' || task.viewStatus === 'queued') classes.push('task-list-item--active');
    if (task.viewStatus === 'waiting_user' || task.viewStatus === 'needs_recovery' || task.viewStatus === 'blocked') {
      classes.push('task-list-item--attention');
    }
    if (isTaskStatusTerminal(task.viewStatus)) classes.push('task-list-item--terminal');
    return classes.join(' ');
  }
</script>

<aside
  class="w-56 shrink-0 flex flex-col border-r min-h-0"
  style="border-color: var(--vscode-panel-border); background: var(--vscode-sideBar-background, transparent);"
>
  <div
    class="flex items-center gap-2 px-2 py-2 border-b"
    style="border-color: var(--vscode-panel-border);"
  >
    <span class="font-semibold text-sm">Tasks</span>
    <span class="flex-1"></span>
    <vscode-button appearance="icon" title="New task" onclick={newTask}>
      <span class="codicon codicon-add"></span>
    </vscode-button>
  </div>

  <div class="flex-1 min-h-0 overflow-y-auto overscroll-contain p-1 flex flex-col gap-0.5">
    {#if tasks.draftMode}
      <div
        class="rounded px-2 py-1.5 text-xs"
        style="background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground);"
      >
        New task (draft)
      </div>
    {/if}

    {#each tasks.rootTasks as task (task.id)}
      {@const presentation = getTaskStatusPresentation(task.viewStatus)}
      {@const flags = taskStateFlags(task)}
      <button
        type="button"
        class={itemClass(task)}
        aria-label={taskAriaLabel(task)}
        onclick={() => selectTask(task.id)}
        style={tasks.focusedTaskId === task.id && !tasks.draftMode
          ? 'background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground);'
          : ''}
      >
        <span class="truncate font-medium">{shortGoal(task.goal)}</span>
        <span class="flex items-center gap-1 flex-wrap" style="opacity: 0.9;">
          <vscode-badge class={statusClass(task.viewStatus)}>{presentation.label}</vscode-badge>
          <span class="task-list-copy">{presentation.listCopy}</span>
          {#if task.continuationOf}
            <span class="task-pill task-pill--muted">cont.</span>
          {/if}
        </span>
        {#if flags.length > 0}
          <span class="sr-only">{flags.join(', ')}</span>
        {/if}
      </button>
    {:else}
      {#if !tasks.draftMode}
        <div class="px-2 py-4 text-center text-xs" style="opacity: 0.6;">No tasks yet.</div>
      {/if}
    {/each}
  </div>
</aside>
