import { exact } from './protocol.js';
import { CHATGPT_METADATA_PROFILE, SOURCE_FAILURE_CODES } from '../collectors/chatgpt/profile.js';
import { PROJECT_PROBE_CODES, type ProjectProbeSummary } from '../collectors/chatgpt/metadata.js';
import type { IdentityProbeSummary } from '../collectors/chatgpt/identity.js';
import { validateMetadataStructure, type MetadataStructureSummary } from '../collectors/chatgpt/structure-probe.js';

export const SOURCE_CHECK_PROTOCOL = 'vaiwl-start-source-check/1';
// One fixed experiment, including its comparisons. There is no reset/retry or authority switch.
export const CHECK_STEPS = ['A-baseline', 'A-switch', 'B-project', 'B-conflict', 'C-none', 'D-start', 'D-repeat', 'D-refresh'] as const;
export type CheckStep = typeof CHECK_STEPS[number];
export const ROUTE_KINDS = ['project', 'conversation', 'unsupported', 'foreign'] as const;
export interface CollectorProbe {
  runId: string; captureId: string; step: CheckStep; authority: false;
  identity: IdentityProbeSummary; project: ProjectProbeSummary;
  structure: MetadataStructureSummary | { state: 'not-requested'; code: 'not-requested'; authority: false };
}
export function checkStep(value: unknown): asserts value is CheckStep {
  if (!CHECK_STEPS.includes(value as CheckStep)) throw Error('INVALID_MESSAGE');
}
export function correlation(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^[a-f0-9-]{36}$/.test(value)) throw Error('INVALID_MESSAGE');
}
function alias(value: unknown, nullable = true) {
  if (!(nullable && value === null) && (typeof value !== 'string' || !/^hmac256:[a-f0-9]{64}$/.test(value))) throw Error('INVALID_MESSAGE');
}
function count(value: unknown, maximum: number) {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > maximum) throw Error('INVALID_MESSAGE');
}
/** Revalidate every exported byte. A collector response can never carry raw metadata or authority. */
export function validateCollectorProbe(value: unknown): asserts value is CollectorProbe {
  exact(value, ['runId', 'captureId', 'step', 'authority', 'identity', 'project', 'structure']);
  correlation(value.runId); correlation(value.captureId); checkStep(value.step);
  if (value.authority !== false) throw Error('INVALID_MESSAGE');
  const i = value.identity;
  exact(i, ['state', 'code', 'profileId', 'principalPresent', 'principalAlias', 'rosterCount', 'contexts', 'currentContext']);
  if (!['candidate', 'blocked'].includes(i.state) || !SOURCE_FAILURE_CODES.includes(i.code) || i.profileId !== CHATGPT_METADATA_PROFILE.id || typeof i.principalPresent !== 'boolean' || i.currentContext !== 'unproven') throw Error('INVALID_MESSAGE');
  alias(i.principalAlias); count(i.rosterCount, 1000);
  if (i.principalPresent !== (i.principalAlias !== null) || !Array.isArray(i.contexts) || i.contexts.length !== i.rosterCount) throw Error('INVALID_MESSAGE');
  for (const c of i.contexts) { exact(c, ['alias', 'kind']); alias(c.alias, false); if (!['personal', 'organization', 'unknown'].includes(c.kind)) throw Error('INVALID_MESSAGE'); }
  const p = value.project;
  exact(p, ['routeKind', 'code', 'assertions', 'memberCount', 'projectAlias', 'projectTitleAlias', 'members']);
  if (!ROUTE_KINDS.includes(p.routeKind) || !PROJECT_PROBE_CODES.includes(p.code)) throw Error('INVALID_MESSAGE');
  exact(p.assertions, ['boundaryUnique', 'titleLeaf', 'panelUnique', 'tabPanelLinked', 'membersStructure', 'containerLinked']);
  if (Object.values(p.assertions).some(v => typeof v !== 'boolean')) throw Error('INVALID_MESSAGE');
  alias(p.projectAlias); alias(p.projectTitleAlias); count(p.memberCount, 256);
  if (!Array.isArray(p.members) || p.members.length > 256 || p.members.length !== (p.code === 'project-candidate-only' ? p.memberCount : 0)) throw Error('INVALID_MESSAGE');
  for (const m of p.members) { exact(m, ['conversationAlias', 'titleAlias']); alias(m.conversationAlias, false); alias(m.titleAlias, false); }
  if (value.structure?.state === 'not-requested') {
    exact(value.structure, ['state', 'code', 'authority']);
    if (value.structure.code !== 'not-requested' || value.structure.authority !== false) throw Error('INVALID_MESSAGE');
  } else if (!validateMetadataStructure(value.structure)) throw Error('INVALID_MESSAGE');
}

export function trustedCheckSender(sender: chrome.runtime.MessageSender, id: string) {
  return sender.id === id && sender.frameId === 0 && !!sender.documentId && Number.isInteger(sender.tab?.id)
    && sender.documentLifecycle === 'active' && sender.url === `chrome-extension://${id}/source-check.html`;
}
