import { Backend } from '../types';
import { ClaudeBackend } from './claude';
import { GrokBackend } from './grok';
import { KiroBackend } from './kiro';

export const BACKEND_IDS = ['claude', 'grok', 'kiro'] as const;
export type BackendId = (typeof BACKEND_IDS)[number];

export function makeBackend(name: string): Backend {
  switch (name) {
    case 'grok':
      return new GrokBackend();
    case 'kiro':
      return new KiroBackend();
    case 'claude':
    default:
      return new ClaudeBackend();
  }
}
