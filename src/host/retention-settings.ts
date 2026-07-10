import packageJson from '../../package.json';

export type RetentionSettingId = 'maxTurnsPerTask' | 'maxStoredOutputChars';

export type RetentionSettingErrorCode =
  | 'unknownSetting'
  | 'invalidType'
  | 'nonFinite'
  | 'nonInteger'
  | 'belowMinimum'
  | 'updateFailed';

export interface RetentionSettingDefinition {
  id: RetentionSettingId;
  configKey: RetentionSettingId;
  label: string;
  description: string;
  defaultValue: number;
  minimum: number;
}

export interface RetentionSettingValue {
  id: RetentionSettingId;
  label: string;
  description: string;
  value: number;
  defaultValue: number;
  minimum: number;
}

export interface RetentionSettingSnapshot {
  settings: RetentionSettingValue[];
}

export type RetentionSettingsValidationResult =
  | { ok: true; settingId: RetentionSettingId; value: number }
  | { ok: false; settingId?: RetentionSettingId; code: RetentionSettingErrorCode; message: string };

export interface RetentionSettingsConfiguration {
  update(key: RetentionSettingId, value: number, target: unknown): Thenable<void> | Promise<void> | void;
}

export interface RetentionSettingsReadableConfiguration extends RetentionSettingsConfiguration {
  get(key: RetentionSettingId): unknown;
}

export type RetentionSettingsHostMessage =
  | { type: 'settingsUpdateResult'; result: RetentionSettingsValidationResult }
  | { type: 'settingsSnapshot'; snapshot: RetentionSettingSnapshot };

const properties = packageJson.contributes.configuration.properties;

/** Shape of a `muster.retention.*` package.json configuration property. Cast at
 * the read site below because `properties` also holds non-retention entries
 * (e.g. `muster.permissions.mode`, an enum/string property) whose union would
 * otherwise widen `default`/`minimum` to types retention settings never use. */
interface RetentionConfigProperty {
  readonly default: number;
  readonly minimum: number;
  readonly description: string;
}

function packageProperty(settingId: RetentionSettingId): RetentionConfigProperty {
  return properties[`muster.retention.${settingId}` as keyof typeof properties] as unknown as RetentionConfigProperty;
}

export const RETENTION_SETTING_DEFINITIONS: RetentionSettingDefinition[] = [
  {
    id: 'maxTurnsPerTask',
    configKey: 'maxTurnsPerTask',
    label: 'Max turns per task',
    description: packageProperty('maxTurnsPerTask').description,
    defaultValue: packageProperty('maxTurnsPerTask').default,
    minimum: packageProperty('maxTurnsPerTask').minimum,
  },
  {
    id: 'maxStoredOutputChars',
    configKey: 'maxStoredOutputChars',
    label: 'Max stored output characters',
    description: packageProperty('maxStoredOutputChars').description,
    defaultValue: packageProperty('maxStoredOutputChars').default,
    minimum: packageProperty('maxStoredOutputChars').minimum,
  },
];

export function isRetentionSettingId(value: unknown): value is RetentionSettingId {
  return value === 'maxTurnsPerTask' || value === 'maxStoredOutputChars';
}

export function retentionSettingDefinition(settingId: RetentionSettingId): RetentionSettingDefinition {
  return RETENTION_SETTING_DEFINITIONS.find((definition) => definition.id === settingId)!;
}

function isValidRetentionSettingValue(value: unknown, definition: RetentionSettingDefinition): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value >= definition.minimum;
}

export function buildRetentionSettingsSnapshot(readConfigValue: (key: RetentionSettingId) => unknown): RetentionSettingSnapshot {
  return {
    settings: RETENTION_SETTING_DEFINITIONS.map((definition) => {
      const configuredValue = readConfigValue(definition.configKey);
      const value = isValidRetentionSettingValue(configuredValue, definition)
        ? configuredValue
        : definition.defaultValue;

      return {
        id: definition.id,
        label: definition.label,
        description: definition.description,
        value,
        defaultValue: definition.defaultValue,
        minimum: definition.minimum,
      };
    }),
  };
}

export function validateRetentionSettingUpdate(input: unknown): RetentionSettingsValidationResult {
  if (typeof input !== 'object' || input === null) {
    return {
      ok: false,
      code: 'unknownSetting',
      message: 'Unsupported retention setting.',
    };
  }

  if (!Object.hasOwn(input, 'settingId')) {
    return {
      ok: false,
      code: 'unknownSetting',
      message: 'Unsupported retention setting.',
    };
  }

  const candidate = input as { settingId?: unknown; value?: unknown };

  if (!isRetentionSettingId(candidate.settingId)) {
    return {
      ok: false,
      code: 'unknownSetting',
      message: 'Unsupported retention setting.',
    };
  }

  const definition = retentionSettingDefinition(candidate.settingId);

  if (!Object.hasOwn(input, 'value') || typeof candidate.value !== 'number') {
    return {
      ok: false,
      settingId: definition.id,
      code: 'invalidType',
      message: `${definition.label} must be a number.`,
    };
  }

  if (!Number.isFinite(candidate.value)) {
    return {
      ok: false,
      settingId: definition.id,
      code: 'nonFinite',
      message: `${definition.label} must be finite.`,
    };
  }

  if (!Number.isInteger(candidate.value)) {
    return {
      ok: false,
      settingId: definition.id,
      code: 'nonInteger',
      message: `${definition.label} must be an integer.`,
    };
  }

  if (candidate.value < definition.minimum) {
    return {
      ok: false,
      settingId: definition.id,
      code: 'belowMinimum',
      message: `${definition.label} must be at least ${definition.minimum}.`,
    };
  }

  return {
    ok: true,
    settingId: definition.id,
    value: candidate.value,
  };
}

export function sanitizeRetentionSettingsError(
  settingId: RetentionSettingId,
  _error: unknown,
): RetentionSettingsValidationResult {
  const definition = retentionSettingDefinition(settingId);
  return {
    ok: false,
    settingId: definition.id,
    code: 'updateFailed',
    message: `Unable to update ${definition.label}.`,
  };
}

export async function persistRetentionSettingUpdate(
  configuration: RetentionSettingsConfiguration,
  input: unknown,
  target: unknown,
): Promise<RetentionSettingsValidationResult> {
  const validation = validateRetentionSettingUpdate(input);
  if (!validation.ok) {
    return validation;
  }

  try {
    await configuration.update(validation.settingId, validation.value, target);
    return validation;
  } catch (error) {
    return sanitizeRetentionSettingsError(validation.settingId, error);
  }
}

export async function handleRetentionSettingUpdateAction(
  configuration: RetentionSettingsReadableConfiguration,
  input: unknown,
  target: unknown,
): Promise<RetentionSettingsHostMessage[]> {
  const result = await persistRetentionSettingUpdate(configuration, input, target);
  const messages: RetentionSettingsHostMessage[] = [{ type: 'settingsUpdateResult', result }];

  if (result.ok) {
    try {
      messages.push({
        type: 'settingsSnapshot',
        snapshot: buildRetentionSettingsSnapshot((key) => configuration.get(key)),
      });
    } catch {
      // Preserve the successful update result. The webview can display saved state
      // even when VS Code configuration cannot be read for a refreshed snapshot.
    }
  }

  return messages;
}
