import type { TaskControlState } from './types.js';

const MINUTE = 60_000;
export const TASK_SCHEDULE_KEY = 'tasks.schedule.v1';
export interface TaskSchedule {
  version: 1; adapter: string; dueAt: number; failures: number; paused: boolean;
  lastAttemptAt: number | null; lastSuccessAt: number | null;
  failureCode: string | null; failedAt: number | null;
  lease: { id: string; until: number } | null;
  lastCycle?: { durationMs: number; pages: number; resultReads: number; code: string | null };
}
export function readSchedule(value: unknown, adapter: string, now: number): TaskSchedule {
  const candidate = value as Partial<TaskSchedule> | null;
  if (!candidate || candidate.version !== 1 || candidate.adapter !== adapter || !Number.isFinite(candidate.dueAt)) {
    return { version: 1, adapter, dueAt: now, failures: 0, paused: false, lastAttemptAt: null, lastSuccessAt: null, failureCode: null, failedAt: null, lease: null };
  }
  return { ...candidate, paused: candidate.paused === true, failures: Number.isInteger(candidate.failures) ? Math.max(0, candidate.failures!) : 0,
    lease: candidate.lease && typeof candidate.lease.id === 'string' && Number.isFinite(candidate.lease.until) ? candidate.lease : null } as TaskSchedule;
}
/** A native task's schedule is a hint. Only an observed output proves completion. */
export function nextHealthySync(state: TaskControlState, now: number): number {
  const current = Object.values(state.catalog).filter(entry => entry.scope.accountId.startsWith((state.principal || '!') + ':'));
  const active = current.filter(entry => entry.task.is_enabled !== false);
  let dueAt = now + (active.length ? 30 : 120) * MINUTE;
  for (const entry of active) {
    const next = Date.parse(entry.task.next_run_time || '');
    if (Number.isFinite(next) && next > now) dueAt = Math.min(dueAt, Math.max(now + 5 * MINUTE, next + 2 * MINUTE));
  }
  return dueAt;
}
export function successfulSchedule(previous: TaskSchedule, state: TaskControlState, now: number): TaskSchedule {
  return { ...previous, dueAt: nextHealthySync(state, now), failures: 0, paused: false, failureCode: null, failedAt: null, lastSuccessAt: now, lease: null };
}
export function failedSchedule(previous: TaskSchedule, code: string, now: number): TaskSchedule {
  // One page can report the same failed native request more than once.
  if (previous.failureCode === code && previous.failedAt !== null && now - previous.failedAt < 30_000) return { ...previous, lease: null };
  const failures = previous.failureCode === code ? previous.failures + 1 : 1;
  const exponent = Math.min(failures - 1, 4);
  let minutes = Math.min(60, 5 * 2 ** exponent);
  if (code === 'RATE_LIMITED') minutes = Math.min(360, 30 * 2 ** exponent);
  if (code === 'VERIFICATION_REQUIRED') minutes = Math.min(360, 30 * 4 ** exponent);
  if (code === 'SOURCE_CHANGED' || code === 'SOURCE_FORBIDDEN') minutes = Math.min(360, 120 * 2 ** exponent);
  if (code === 'PARTIAL_LIST') minutes = 30;
  // Authentication is resumed by the user's ordinary signed-in source page.
  if (code === 'LOGIN_REQUIRED' || code === 'PERMISSION_REQUIRED' || code === 'DISABLED') minutes = 24 * 60;
  const paused=['LOGIN_REQUIRED','PERMISSION_REQUIRED','DISABLED'].includes(code)
    || (failures >= 3 && ['VERIFICATION_REQUIRED','SOURCE_CHANGED','SOURCE_FORBIDDEN'].includes(code))
    || (code === 'RATE_LIMITED' && failures >= 6);
  return { ...previous, dueAt: now + minutes * MINUTE, failures, paused, failureCode: code, failedAt: now, lease: null };
}
export function syncIsDue(schedule: TaskSchedule, now: number, manual = false): boolean {
  if (schedule.paused) return false;
  if (schedule.lease && schedule.lease.until > now) return false;
  if (['LOGIN_REQUIRED', 'PERMISSION_REQUIRED', 'DISABLED'].includes(schedule.failureCode || '')) return false;
  return schedule.dueAt <= now || (manual && (!schedule.failureCode || ['PARTIAL_LIST','SOURCE_TAKEN_OVER'].includes(schedule.failureCode)));
}
