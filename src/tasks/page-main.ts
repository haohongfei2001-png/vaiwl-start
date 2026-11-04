import { extractPacket, sourceKind } from './source.js';
import type { SourcePacket } from './types.js';
// Passive observation only: the native page owns its normal requests and authentication.
// This module never reads request headers, session responses or credentials.
const originalFetch = window.fetch;
let ready = false, stopped = false;
const pending: SourcePacket[] = [];
function emit(packet: SourcePacket) {
  if (stopped || location.href !== packet.pageHref) return;
  if (ready) window.postMessage({channel:'vaiwl-task-source/1', packet}, 'https://chatgpt.com');
  else { if (pending.length >= 8) pending.shift(); pending.push(packet); }
}
// MAIN and ISOLATED document_start scripts have no guaranteed relative order.
// Retain only sanitized packets until the relay confirms its listener is installed.
window.addEventListener('message', event => {
  if (event.source !== window || event.origin !== 'https://chatgpt.com') return;
  if(event.data?.channel==='vaiwl-task-stop/1'){stopped=true;pending.length=0;return;}
  if(stopped||event.data?.channel!=='vaiwl-task-ready/1')return;
  ready = true; for (const packet of pending.splice(0)) emit(packet);
});
window.postMessage({channel:'vaiwl-task-init/1'}, 'https://chatgpt.com');
window.fetch = async function (...args: Parameters<typeof fetch>): Promise<Response> {
  const pageHref = location.href, observedAt = new Date().toISOString();
  const response = await Reflect.apply(originalFetch, this, args);
  if (!stopped && sourceKind(response.url, pageHref)) {
    void (async () => {
      let packet: SourcePacket | null;
      try {
        if (response.status === 429) throw Error('RATE_LIMITED');
        if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) throw Error('SOURCE_UNAVAILABLE');
        const stream = response.clone().body?.getReader();
        if (!stream) throw Error('SOURCE_CHANGED');
        // Bound the observation copy without cancelling the native page's response.
        const chunks: Uint8Array[] = []; let bytes = 0;
        for (;;) {
          const part = await stream.read(); if (part.done) break;
          bytes += part.value.byteLength;
          if (bytes > 16_000_000) { void stream.cancel().catch(() => {}); throw Error('SOURCE_CHANGED'); }
          chunks.push(part.value);
        }
        const joined = new Uint8Array(bytes); let offset = 0;
        for (const part of chunks) { joined.set(part, offset); offset += part.byteLength; }
        const data: unknown = JSON.parse(new TextDecoder().decode(joined));
        packet = extractPacket(response.url, pageHref, observedAt, data);
      } catch (e) { packet = {kind:'error', code:e instanceof Error && ['RATE_LIMITED','SOURCE_UNAVAILABLE'].includes(e.message) ? e.message : 'SOURCE_CHANGED', pageHref, observedAt}; }
      if (packet) emit(packet);
    })();
  }
  return response;
};
