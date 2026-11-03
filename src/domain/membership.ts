import type { EvidenceWitness, Membership } from '../../contracts/free-v1.js';
import { boundedString, exactObject, iso } from './validation.js';
export interface MembershipContext { scopeKey: string; documentId: string; routeEpoch: number; scopeEpoch: number }
export interface MembershipProposal { membership: Membership; witness: EvidenceWitness }
export function validateMembership(value: Membership, witness?: EvidenceWitness): void {
  if (!value || typeof value !== 'object') throw Error('invalid-membership');
  if (value.state === 'UNKNOWN') {
    exactObject(value, ['state', 'projectId', 'reason'], ['lastConfirmed']);
    if (value.projectId !== null || !['scope-unverified', 'no-membership-source', 'conflicting-evidence', 'source-revoked', 'unsupported-adapter'].includes(value.reason)) throw Error('invalid-membership');
    if (value.lastConfirmed !== undefined) { if (value.lastConfirmed.state !== 'PROJECT' && value.lastConfirmed.state !== 'NONE') throw Error('invalid-last-confirmed'); validateMembership(value.lastConfirmed); }
    return;
  }
  exactObject(value, ['state', 'projectId', 'evidenceId', 'confirmedAt']);
  if (value.state === 'PROJECT') { if (typeof value.projectId !== 'string' || !/^g-p-[0-9a-f]{32}$/.test(value.projectId)) throw Error('invalid-membership-project'); }
  else if (value.state !== 'NONE' || value.projectId !== null) throw Error('invalid-membership');
  boundedString(value.evidenceId, 256); iso(value.confirmedAt);
  if (witness) {
    if (witness.kind === 'native-explicit-none' && value.state !== 'NONE' || witness.kind === 'native-project-member-region' && value.state !== 'PROJECT' || witness.kind === 'verified-session-context') throw Error('membership-source-mismatch');
  }
}
export function reduceMembership(previous: Membership, incoming: MembershipProposal, current: MembershipContext, previousWitness?: EvidenceWitness): Membership {
  const { witness, membership } = incoming;
  validateMembership(previous); validateMembership(membership, witness);
  if (witness.scopeKey !== current.scopeKey || witness.documentId !== current.documentId || witness.routeEpoch !== current.routeEpoch || witness.scopeEpoch !== current.scopeEpoch) return previous;
  if (!witness.fields.includes('membership')) return previous;
  if (witness.revoked) return { state: 'UNKNOWN', projectId: null, reason: 'source-revoked', ...(previous.state !== 'UNKNOWN' ? { lastConfirmed: previous } : {}) };
  if (membership.state === 'UNKNOWN') return membership.reason === 'conflicting-evidence' ? { ...membership, ...(previous.state !== 'UNKNOWN' ? { lastConfirmed: previous } : {}) } : previous;
  if (!['native-project-member-region', 'native-explicit-none', 'allowlisted-metadata'].includes(witness.kind)) return previous;
  if (membership.state === 'NONE' && witness.kind === 'native-project-member-region') return previous;
  if (membership.evidenceId !== witness.id || membership.confirmedAt !== witness.observedAt) return previous;
  if (previousWitness) {
    if (witness.sourceDomain === previousWitness.sourceDomain && witness.sourceRevision < previousWitness.sourceRevision) return previous;
    // A replay of either side of a conflict must not turn UNKNOWN back into an assertion.
    // Only a strictly newer comparable revision can settle the disputed snapshot.
    if (previous.state === 'UNKNOWN' && previous.reason === 'conflicting-evidence' && (witness.sourceDomain !== previousWitness.sourceDomain || witness.sourceRevision <= previousWitness.sourceRevision)) return previous;
    const changed = previous.state !== 'UNKNOWN' && (previous.state !== membership.state || previous.projectId !== membership.projectId);
    if (changed && (witness.sourceDomain !== previousWitness.sourceDomain || witness.sourceRevision === previousWitness.sourceRevision)) return { state: 'UNKNOWN', projectId: null, reason: 'conflicting-evidence', lastConfirmed: previous as Exclude<Membership, { state: 'UNKNOWN' }> };
  }
  if (previous.state === 'UNKNOWN' && previous.reason === 'conflicting-evidence' && !previousWitness) return previous;
  return membership;
}
