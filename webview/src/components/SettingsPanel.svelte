<script lang="ts">
  import type { RetentionSettingId, RetentionSettingSnapshot } from '../lib/protocol';

  interface Props {
    onClose: () => void;
    snapshot: RetentionSettingSnapshot | null;
    loading: boolean;
    savingSettingId: RetentionSettingId | null;
    savedMessage: string | null;
    globalError: string | null;
    fieldErrors: Partial<Record<RetentionSettingId, string>>;
    onSave: (settingId: RetentionSettingId, value: number) => void;
  }

  const LABELS: Record<RetentionSettingId, string> = {
    maxTurnsPerTask: 'Maximum turns per task',
    maxStoredOutputChars: 'Maximum stored output characters',
  };

  let {
    onClose,
    snapshot,
    loading,
    savingSettingId,
    savedMessage,
    globalError,
    fieldErrors,
    onSave,
  }: Props = $props();

  let drafts = $state<Record<RetentionSettingId, string>>({
    maxTurnsPerTask: '',
    maxStoredOutputChars: '',
  });
  let localFieldErrors = $state<Partial<Record<RetentionSettingId, string>>>({});
  let hydratedSignature = $state('');

  function hydrateDraftsFromSnapshot() {
    if (!snapshot) return;
    drafts = snapshot.settings.reduce(
      (next, setting) => ({ ...next, [setting.id]: String(setting.value) }),
      {} as Record<RetentionSettingId, string>,
    );
    hydratedSignature = snapshot.settings.map((setting) => `${setting.id}:${setting.value}`).join('|');
  }

  $effect(() => {
    const signature = snapshot ? snapshot.settings.map((setting) => `${setting.id}:${setting.value}`).join('|') : '';
    if (!signature || signature === hydratedSignature) return;
    hydrateDraftsFromSnapshot();
  });

  $effect(() => {
    if (!globalError || !snapshot) return;
    hydrateDraftsFromSnapshot();
  });

  function displayLabel(settingId: RetentionSettingId): string {
    return LABELS[settingId];
  }

  function fieldId(settingId: RetentionSettingId): string {
    return `settings-${settingId}`;
  }

  function updateDraft(settingId: RetentionSettingId, value: string) {
    drafts = { ...drafts, [settingId]: value };
    localFieldErrors = { ...localFieldErrors, [settingId]: undefined };
  }

  function onDraftInput(settingId: RetentionSettingId, event: Event) {
    updateDraft(settingId, (event.currentTarget as HTMLInputElement).value);
  }

  function validationMessage(settingId: RetentionSettingId, minimum: number): string | null {
    const label = displayLabel(settingId);
    const raw = drafts[settingId]?.trim() ?? '';
    const value = Number(raw);

    if (!raw || !Number.isFinite(value)) return `${label} must be a number.`;
    if (!Number.isInteger(value)) return `${label} must be an integer.`;
    if (value < minimum) return `${label} must be at least ${minimum}.`;
    return null;
  }

  function saveSetting(settingId: RetentionSettingId, minimum: number) {
    const message = validationMessage(settingId, minimum);
    if (message) {
      localFieldErrors = { ...localFieldErrors, [settingId]: message };
      return;
    }

    localFieldErrors = { ...localFieldErrors, [settingId]: undefined };
    onSave(settingId, Number(drafts[settingId]));
  }
</script>

<section class="settings-panel" aria-labelledby="settings-panel-title">
  <div class="settings-panel__header">
    <div class="min-w-0">
      <h2 id="settings-panel-title" class="settings-panel__title">Settings</h2>
      <p class="settings-panel__subtitle">Backed by VS Code configuration</p>
    </div>
    <button type="button" class="icon-btn settings-panel__close" onclick={onClose} aria-label="Close settings" title="Close settings">
      <span class="codicon codicon-close" aria-hidden="true"></span>
    </button>
  </div>

  <div class="settings-panel__body">
    <p class="settings-panel__intro">Retention keeps recent task history usable without storing unlimited completed-turn output.</p>

    {#if loading && !snapshot}
      <p class="settings-panel__notice" role="status">Loading retention settings from VS Code…</p>
    {:else if snapshot}
      <p class="settings-panel__notice" role="status">Settings ready. Edit one field at a time; each Save writes only that VS Code setting.</p>
    {:else}
      <p class="settings-panel__notice">These values are read from and saved back to VS Code settings.</p>
    {/if}

    {#if globalError}
      <div class="settings-panel__error" role="alert">
        <div class="settings-panel__error-title">Settings save failed</div>
        <div>{globalError}</div>
      </div>
    {/if}

    {#if savedMessage}
      <div class="settings-panel__success" role="status">{savedMessage}</div>
    {/if}

    {#if snapshot}
      <div class="settings-panel__group" aria-label="Retention settings">
        {#each snapshot.settings as setting (setting.id)}
          {@const label = displayLabel(setting.id)}
          {@const error = localFieldErrors[setting.id] ?? fieldErrors[setting.id]}
          <div class="settings-panel__row settings-panel__row--editable">
            <div class="settings-panel__copy">
              <label class="settings-panel__label" for={fieldId(setting.id)}>{label}</label>
              <div class="settings-panel__description">{setting.description}</div>
              <div class="settings-panel__hint">Minimum {setting.minimum}. Default {setting.defaultValue}.</div>
              {#if error}
                <div class="settings-panel__field-error" id={`${fieldId(setting.id)}-error`} role="alert">{error}</div>
              {/if}
            </div>
            <div class="settings-panel__control">
              <input
                id={fieldId(setting.id)}
                class="settings-panel__input"
                type="number"
                min={setting.minimum}
                step="1"
                value={drafts[setting.id]}
                aria-invalid={error ? 'true' : 'false'}
                aria-describedby={error ? `${fieldId(setting.id)}-error` : undefined}
                disabled={savingSettingId === setting.id}
                oninput={(event) => onDraftInput(setting.id, event)}
              />
              <button
                type="button"
                class="settings-panel__save"
                disabled={savingSettingId === setting.id}
                onclick={() => saveSetting(setting.id, setting.minimum)}
              >Save {label}</button>
              {#if savingSettingId === setting.id}
                <div class="settings-panel__saving" role="status">Saving {label}…</div>
              {/if}
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </div>
</section>
