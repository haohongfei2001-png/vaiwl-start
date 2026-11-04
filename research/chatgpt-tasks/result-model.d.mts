import type { ModelStore, TaskScope } from '../../src/tasks/types.js';
export function createStore(): ModelStore;
export function ingest(store: ModelStore, observation: { scope: TaskScope; observedAt: string; tasks?: unknown[]; syncStatus?: 'ok' | 'error'; errorCode?: string | null }): ModelStore;
export function project(store: ModelStore, scope: TaskScope, options?: { mode?: 'workspace' | 'life'; now?: string | null; staleAfterMs?: number; includeBodies?: boolean }): any;
export function classify(store: ModelStore, input: {scope: TaskScope; taskId: string; runId: string; resultRevision: number; classifiedAt: string; outcome: string; evidence: {kind: 'user' | 'structured'; reference: string}}): ModelStore;
export function previewText(body: string, limit?: number): string;
export function sourceUrls(body: string): string[];
