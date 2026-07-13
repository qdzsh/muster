import type { TaskRuntimeActivity, TaskSummary } from './protocol';
import { effectiveRuntimeActivity } from './protocol';
import type { TaskStatusTone } from './task-status';

/**
 * Phase A temporary client-side turn chrome (no CLI/process vocabulary).
 * Phase B replaces this with host-projected `currentTurnActivity`.
 */
export type TurnActivityState =
  | 'queued'
  | 'executing'
  | 'waiting_you'
  | 'failed_turn'
  | 'null';

export interface TurnActivityPresentation {
  state: TurnActivityState;
  label: string;
  hint: string;
  detail: string;
  tone: TaskStatusTone;
  icon: string;
  /** When false, composer shows no activity strip (ready / between turns). */
  showStrip: boolean;
}

const PRESENTATIONS: Record<Exclude<TurnActivityState, 'null'>, Omit<TurnActivityPresentation, 'state' | 'showStrip'>> = {
  executing: {
    label: 'Working',
    hint: 'turn in progress',
    detail: 'A turn is executing for this task.',
    tone: 'attention',
    icon: 'loading',
  },
  waiting_you: {
    label: 'Waiting for you',
    hint: 'answer required',
    detail: 'The turn is waiting for your answer.',
    tone: 'info',
    icon: 'debug-pause',
  },
  queued: {
    label: 'Queued',
    hint: 'waiting to start',
    detail: 'A turn is queued and will start when ready.',
    tone: 'muted',
    icon: 'clock',
  },
  failed_turn: {
    label: 'Could not finish',
    hint: 'turn needs attention',
    detail: 'The last turn could not finish. The task stays open.',
    tone: 'danger',
    icon: 'warning',
  },
};

/** Map open-task runtime (+ live stream flags) to turn activity chrome. */
export function deriveTurnActivityState(input: {
  lifecycle: string;
  runtimeActivity: TaskRuntimeActivity | null | undefined;
  threadRunning?: boolean;
  askPending?: boolean;
}): TurnActivityState {
  const runtime = input.runtimeActivity ?? null;

  if (input.askPending || runtime === 'waiting_user') {
    return 'waiting_you';
  }
  if (input.threadRunning || runtime === 'running') {
    return 'executing';
  }
  if (runtime === 'queued') {
    return 'queued';
  }
  if (runtime === 'needs_recovery') {
    return 'failed_turn';
  }
  // waiting_dependencies / waiting_children / blocked / awaiting_outcome / idle / terminal:
  // no process strip — ready or orchestration elsewhere.
  return 'null';
}

export function turnActivityFromTask(
  task: Pick<TaskSummary, 'lifecycle' | 'runtimeActivity' | 'viewStatus'>,
  opts?: { threadRunning?: boolean; askPending?: boolean },
): TurnActivityState {
  return deriveTurnActivityState({
    lifecycle: task.lifecycle,
    runtimeActivity: effectiveRuntimeActivity(task),
    threadRunning: opts?.threadRunning,
    askPending: opts?.askPending,
  });
}

export function getTurnActivityPresentation(state: TurnActivityState): TurnActivityPresentation {
  if (state === 'null') {
    return {
      state: 'null',
      label: '',
      hint: '',
      detail: '',
      tone: 'muted',
      icon: 'circle-outline',
      showStrip: false,
    };
  }
  return { state, showStrip: true, ...PRESENTATIONS[state] };
}
