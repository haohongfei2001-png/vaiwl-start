import type { TaskState } from './types.js';
export const SOURCE_ERRORS = ['SOURCE_CHANGED','SOURCE_UNAVAILABLE','SOURCE_FORBIDDEN','LOGIN_REQUIRED','VERIFICATION_REQUIRED','RATE_LIMITED','NETWORK_ERROR'] as const;
/** Only explicit response signals identify a login or Cloudflare challenge. */
export function responseFailure(response: Pick<Response, 'status' | 'headers'>): string | null {
  if (response.headers.get('cf-mitigated') === 'challenge') return 'VERIFICATION_REQUIRED';
  if (response.status === 401) return 'LOGIN_REQUIRED';
  if (response.status === 429) return 'RATE_LIMITED';
  if (response.status === 403) return 'SOURCE_FORBIDDEN';
  return response.status >= 400 ? 'SOURCE_UNAVAILABLE' : null;
}
const latestFailure=(state:TaskState)=>Object.values(state.sourceFailures||{}).sort((a,b)=>Number(b.code==='RATE_LIMITED')-Number(a.code==='RATE_LIMITED')||b.observedAt.localeCompare(a.observedAt))[0];
export function recordFailure(state: TaskState, target: string, code: string, observedAt: string) {
  if ((state.sourceReads?.[target] || '') > observedAt) return;
  const failures = state.sourceFailures ||= {};
  if (failures[target] && failures[target].observedAt > observedAt) return;
  failures[target] = {code, observedAt};
  state.sync.code = latestFailure(state)?.code || code;
  if (code === 'RATE_LIMITED') { state.sync.retryAt = new Date(Date.parse(observedAt) + 30 * 60_000).toISOString(); state.sync.retrySource=target; }
  if (state.sync.status !== 'syncing') state.sync.status = 'error';
}
export function recoverSource(state: TaskState, target: string, observedAt: string) {
  const reads=state.sourceReads ||= {};
  if ((reads[target] || '') > observedAt) return;
  reads[target]=observedAt;
  const failures = state.sourceFailures ||= {};
  if (failures[target] && failures[target].observedAt <= observedAt) delete failures[target];
  const latest = latestFailure(state);
  if (state.sync.retrySource===target && !failures[target]) {state.sync.retryAt=null;state.sync.retrySource=null;}
  state.sync.code = latest?.code || null;
}
