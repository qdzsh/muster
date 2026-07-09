<script lang="ts">
  interface Props {
    inChat?: boolean;
    historyOpen?: boolean;
    settingsOpen?: boolean;
    toggleHistory?: () => void;
    onOpenSettings?: () => void;
  }

  let { inChat = false, settingsOpen = false, onOpenSettings = () => {} }: Props = $props();
</script>

<div
  class="flex items-center gap-2 px-3 py-1 border-b shrink-0"
  style="border-color: var(--vscode-panel-border); background: var(--vscode-titleBar-activeBackground, var(--vscode-sideBar-background));"
>
  <span class="font-semibold">Muster</span>

  {#if !inChat}
    <span class="text-xs opacity-60">— previous tasks</span>
  {/if}

  <span class="flex-1"></span>

  <button
    type="button"
    class="icon-btn"
    style="width: 24px; height: 24px;"
    onclick={onOpenSettings}
    aria-label="Settings"
    aria-pressed={settingsOpen}
    title="Settings"
  >
    <span class="codicon codicon-settings-gear" aria-hidden="true"></span>
  </button>
</div>