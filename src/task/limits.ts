import type { TaskStoreFile } from './types';

export interface ResourceLimits {
  maxDepth: number;
  maxChildrenPerTask: number;
  maxChildrenPerRoot: number;
  maxTurnsPerTask: number;
  maxConcurrentTurns: number;
  maxConcurrentPerRoot: number;
  maxConcurrentPerBackend: number;
  maxResultBytes: number;
  maxErrorBytes: number;
}

export const DEFAULT_RESOURCE_LIMITS: ResourceLimits = {
  maxDepth: 8,
  maxChildrenPerTask: 32,
  maxChildrenPerRoot: 64,
  maxTurnsPerTask: 50,
  maxConcurrentTurns: 4,
  maxConcurrentPerRoot: 4,
  maxConcurrentPerBackend: 2,
  maxResultBytes: 16_384,
  maxErrorBytes: 4_096,
};

export type LimitKind =
  | 'depth'
  | 'children_per_task'
  | 'children_per_root'
  | 'turns_per_task'
  | 'result_size'
  | 'error_size';

export interface LimitContext {
  file: TaskStoreFile;
  parentId: string | null;
  rootId: string;
  taskId?: string;
  childCountForParent?: number;
  childCountForRoot?: number;
  turnCount?: number;
  resultBytes?: number;
  errorBytes?: number;
}

export function effectiveTurnCap(
  task: { executionPolicy: { maxTurns: number } },
  limits: ResourceLimits,
): number {
  return Math.min(limits.maxTurnsPerTask, task.executionPolicy.maxTurns);
}

export function canCreateTurn(
  file: TaskStoreFile,
  taskId: string,
  limits: ResourceLimits,
): { ok: true } | { ok: false; reason: string } {
  const task = file.tasks[taskId];
  if (!task) {
    return { ok: false, reason: 'task not found' };
  }
  const cap = effectiveTurnCap(task, limits);
  const slotsUsed = Object.values(file.turns).filter(
    (turn) => turn.taskId === taskId && turn.status !== 'queued',
  ).length;
  if (slotsUsed >= cap) {
    return { ok: false, reason: 'max turns per task exceeded' };
  }
  return { ok: true };
}

export function taskDepth(file: TaskStoreFile, taskId: string): number {
  let depth = 0;
  let current = file.tasks[taskId];
  while (current?.parentId) {
    depth += 1;
    current = file.tasks[current.parentId];
    if (!current) {
      break;
    }
  }
  return depth;
}

export function countChildren(file: TaskStoreFile, parentId: string): number {
  return Object.values(file.tasks).filter((t) => t.parentId === parentId).length;
}

export function countRootChildren(file: TaskStoreFile, rootId: string): number {
  return Object.values(file.tasks).filter((t) => {
    let current = t;
    while (current.parentId) {
      const parent = file.tasks[current.parentId];
      if (!parent) {
        return current.id === rootId || false;
      }
      current = parent;
    }
    return current.id === rootId && t.id !== rootId;
  }).length;
}

export function checkLimit(
  kind: LimitKind,
  limits: ResourceLimits,
  ctx: LimitContext,
): { ok: true } | { ok: false; reason: string } {
  switch (kind) {
    case 'depth': {
      if (!ctx.taskId) {
        return { ok: false, reason: 'task id required for depth check' };
      }
      const depth = taskDepth(ctx.file, ctx.taskId);
      if (depth >= limits.maxDepth) {
        return { ok: false, reason: 'max depth exceeded' };
      }
      return { ok: true };
    }
    case 'children_per_task': {
      const count = ctx.childCountForParent ?? (ctx.parentId ? countChildren(ctx.file, ctx.parentId) : 0);
      if (count >= limits.maxChildrenPerTask) {
        return { ok: false, reason: 'max children per task exceeded' };
      }
      return { ok: true };
    }
    case 'children_per_root': {
      const count = ctx.childCountForRoot ?? countRootChildren(ctx.file, ctx.rootId);
      if (count >= limits.maxChildrenPerRoot) {
        return { ok: false, reason: 'max children per root exceeded' };
      }
      return { ok: true };
    }
    case 'turns_per_task': {
      const count = ctx.turnCount ?? 0;
      if (count >= limits.maxTurnsPerTask) {
        return { ok: false, reason: 'max turns per task exceeded' };
      }
      return { ok: true };
    }
    case 'result_size': {
      if ((ctx.resultBytes ?? 0) > limits.maxResultBytes) {
        return { ok: false, reason: 'result too large' };
      }
      return { ok: true };
    }
    case 'error_size': {
      if ((ctx.errorBytes ?? 0) > limits.maxErrorBytes) {
        return { ok: false, reason: 'error too large' };
      }
      return { ok: true };
    }
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}