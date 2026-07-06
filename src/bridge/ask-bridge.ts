import { randomUUID } from 'crypto';

export interface Question {
  prompt: string;
  options?: string[];
  allowFreeText?: boolean;
}

export type Answers = Record<string, { selected: string[]; freeText: string | null }>;

export type AskRef = { taskId: string; turnId: string; askId: string };

interface PendingAsk extends AskRef {
  questions: Question[];
  promise: Promise<Answers>;
  resolve: (a: Answers) => void;
  reject: (e: Error) => void;
  createdAt: number;
}

function tripletKey(ref: AskRef): string {
  return `${ref.taskId}:${ref.turnId}:${ref.askId}`;
}

export class AskBridge {
  private readonly pending = new Map<string, PendingAsk>();
  private readonly onRegister?: (ref: AskRef, questions: Question[]) => void;

  constructor(options?: { onRegister?: (ref: AskRef, questions: Question[]) => void }) {
    this.onRegister = options?.onRegister;
  }

  generateAskId(): string {
    return randomUUID();
  }

  register(ref: AskRef, questions: Question[], deadlineMs: number): Promise<Answers> {
    const key = tripletKey(ref);
    const existing = this.pending.get(key);
    if (existing) {
      return existing.promise;
    }

    let resolve!: (answers: Answers) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<Answers>((res, rej) => {
      resolve = res;
      reject = rej;
    });

    const entry: PendingAsk = {
      ...ref,
      questions,
      promise,
      resolve,
      reject,
      createdAt: Date.now(),
    };
    this.pending.set(key, entry);
    this.onRegister?.(ref, questions);

    if (deadlineMs > 0) {
      setTimeout(() => {
        const current = this.pending.get(key);
        if (current === entry) {
          this.pending.delete(key);
          reject(new Error('ask_user timed out'));
        }
      }, deadlineMs);
    }

    return promise;
  }

  hasPending(ref: AskRef): boolean {
    return this.pending.has(tripletKey(ref));
  }

  submit(ref: AskRef, answers: Answers): boolean {
    const key = tripletKey(ref);
    const entry = this.pending.get(key);
    if (!entry) {
      return false;
    }
    this.pending.delete(key);
    entry.resolve(answers);
    return true;
  }

  cancel(ref: AskRef, reason: string): void {
    const key = tripletKey(ref);
    const entry = this.pending.get(key);
    if (!entry) {
      return;
    }
    this.pending.delete(key);
    entry.reject(new Error(reason));
  }

  cancelForTurn(turnId: string, reason: string): void {
    for (const [key, entry] of this.pending) {
      if (entry.turnId === turnId) {
        this.pending.delete(key);
        entry.reject(new Error(reason));
      }
    }
  }

  cancelAll(reason: string): void {
    for (const [, entry] of this.pending) {
      entry.reject(new Error(reason));
    }
    this.pending.clear();
  }
}