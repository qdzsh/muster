import { describe, expect, it, vi } from 'vitest';

vi.mock('./vscode', () => ({
  vscode: {
    postMessage: vi.fn(),
    getState: vi.fn(),
    setState: vi.fn(),
  },
}));

import { isExtMessage, post, type OutMessage, type RetentionSettingSnapshot } from './protocol';
import { vscode } from './vscode';

const snapshot: RetentionSettingSnapshot = {
  settings: [
    {
      id: 'maxTurnsPerTask',
      label: 'Max turns per task',
      description: 'Maximum persisted turns retained per terminal task.',
      value: 200,
      defaultValue: 200,
      minimum: 1,
    },
    {
      id: 'maxStoredOutputChars',
      label: 'Max stored output characters',
      description: 'Maximum stored assistant output characters per settled turn on open tasks.',
      value: 200000,
      defaultValue: 200000,
      minimum: 1024,
    },
  ],
};

describe('settings protocol guard', () => {
  it('accepts a valid retention settings snapshot from the host', () => {
    expect(isExtMessage({ type: 'settingsSnapshot', snapshot })).toBe(true);
  });

  it('rejects malformed settings snapshots from the host', () => {
    const malformedMessages = [
      { type: 'settingsSnapshot' },
      { type: 'settingsSnapshot', snapshot: { settings: 'not-array' } },
      { type: 'settingsSnapshot', snapshot: { settings: [{ ...snapshot.settings[0], id: 'unsupported' }] } },
      { type: 'settingsSnapshot', snapshot: { settings: [{ ...snapshot.settings[0], value: '200' }] } },
      { type: 'settingsSnapshot', snapshot: { settings: [{ ...snapshot.settings[0], value: Number.NaN }] } },
      { type: 'settingsSnapshot', snapshot: { settings: [{ ...snapshot.settings[0], value: 1.5 }] } },
      { type: 'settingsSnapshot', snapshot: { settings: [{ ...snapshot.settings[0], value: 0 }] } },
      { type: 'settingsSnapshot', snapshot: { settings: [{ ...snapshot.settings[0], minimum: Number.POSITIVE_INFINITY }] } },
      { type: 'settingsSnapshot', snapshot: { settings: [{ ...snapshot.settings[0], minimum: 0 }] } },
      { type: 'settingsSnapshot', snapshot: { settings: [{ ...snapshot.settings[0], label: 42 }] } },
      { type: 'settingsSnapshot', snapshot: { settings: [snapshot.settings[0]] } },
      { type: 'settingsSnapshot', snapshot: { settings: [snapshot.settings[0], snapshot.settings[0]] } },
    ];

    for (const message of malformedMessages) {
      expect(isExtMessage(message), JSON.stringify(message)).toBe(false);
    }
  });

  it('accepts sanitized settings update results from the host', () => {
    expect(
      isExtMessage({
        type: 'settingsUpdateResult',
        result: { ok: true, settingId: 'maxTurnsPerTask', value: 50 },
      }),
    ).toBe(true);

    expect(
      isExtMessage({
        type: 'settingsUpdateResult',
        result: {
          ok: false,
          settingId: 'maxStoredOutputChars',
          code: 'belowMinimum',
          message: 'Max stored output characters must be at least 1024.',
        },
      }),
    ).toBe(true);

    expect(
      isExtMessage({
        type: 'settingsUpdateResult',
        result: {
          ok: false,
          code: 'unknownSetting',
          message: 'Unsupported retention setting.',
        },
      }),
    ).toBe(true);
  });

  it('rejects malformed settings update results from the host', () => {
    const malformedMessages = [
      { type: 'settingsUpdateResult', result: { ok: true, settingId: 'unknown', value: 10 } },
      { type: 'settingsUpdateResult', result: { ok: true, settingId: 'maxTurnsPerTask', value: '10' } },
      { type: 'settingsUpdateResult', result: { ok: true, settingId: 'maxTurnsPerTask', value: 1.5 } },
      { type: 'settingsUpdateResult', result: { ok: true, settingId: 'maxStoredOutputChars', value: 1023 } },
      { type: 'settingsUpdateResult', result: { ok: false, settingId: 'maxTurnsPerTask', code: 'raw-stack', message: 'x' } },
      { type: 'settingsUpdateResult', result: { ok: false, settingId: 'maxTurnsPerTask', code: 'invalidType' } },
      { type: 'settingsUpdateResult', result: { ok: false, settingId: 'unknown', code: 'unknownSetting', message: 'x' } },
    ];

    for (const message of malformedMessages) {
      expect(isExtMessage(message), JSON.stringify(message)).toBe(false);
    }
  });

  it('rejects unsupported settings payload shapes and unrelated message types', () => {
    const unsupportedMessages = [
      { type: 'settingsSnapshot', snapshot, extra: 'ignored?' },
      { type: 'settingsUpdateResult', result: { ok: true, settingId: 'maxTurnsPerTask', value: 50 }, extra: 'ignored?' },
      { type: 'settingsUpdateResult', result: { ok: false, code: 'unknownSetting', message: 'Unsupported retention setting.' }, extra: 'ignored?' },
      { type: 'settingsUpdated', settingId: 'maxTurnsPerTask', value: 50 },
      { type: 'settingsError', settingId: 'maxTurnsPerTask', message: 'Host rejected update.' },
      { type: 'settingsSnapshot', snapshot, result: { ok: true, settingId: 'maxTurnsPerTask', value: 50 } },
      { type: 'unrelatedSettingsMessage', snapshot },
    ];

    for (const message of unsupportedMessages) {
      expect(isExtMessage(message), JSON.stringify(message)).toBe(false);
    }
  });
});

describe('settings outbound protocol', () => {
  it('posts explicit request and update messages to the extension host', () => {
    const messages: OutMessage[] = [
      { type: 'requestSettings' },
      { type: 'updateSetting', settingId: 'maxTurnsPerTask', value: 25 },
      { type: 'updateSetting', settingId: 'maxStoredOutputChars', value: 4096 },
    ];

    for (const message of messages) {
      post(message);
    }

    expect(vscode.postMessage).toHaveBeenNthCalledWith(1, { type: 'requestSettings' });
    expect(vscode.postMessage).toHaveBeenNthCalledWith(2, {
      type: 'updateSetting',
      settingId: 'maxTurnsPerTask',
      value: 25,
    });
    expect(vscode.postMessage).toHaveBeenNthCalledWith(3, {
      type: 'updateSetting',
      settingId: 'maxStoredOutputChars',
      value: 4096,
    });
  });
});
