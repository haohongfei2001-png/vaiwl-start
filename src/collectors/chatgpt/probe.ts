/** Ephemeral, per-run diagnostic correlation only. These aliases are never scope,
 * membership or arrival evidence. The random key must not enter exported reports. */
export type ProbeAliasDomain = 'principal' | 'context' | 'project' | 'conversation' | 'project-title' | 'conversation-title';
export const PROBE_ALIAS_PATTERN = /^hmac256:[0-9a-f]{64}$/;

export async function createProbeAliaser(saltHex: string): Promise<(domain: ProbeAliasDomain, value: string) => Promise<string>> {
  if (typeof saltHex !== 'string' || !/^[0-9a-f]{64}$/.test(saltHex)) throw Error('invalid-probe-salt');
  const bytes = new Uint8Array(32);
  for (let index = 0; index < bytes.length; index++) bytes[index] = Number.parseInt(saltHex.slice(index * 2, index * 2 + 2), 16);
  const key = await crypto.subtle.importKey('raw', bytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  bytes.fill(0);
  return async (domain, value) => {
    if (typeof value !== 'string' || !value || value.length > 512) throw Error('invalid-probe-value');
    const input = new TextEncoder().encode(JSON.stringify(['vaiwl-start-source-probe/1', domain, value]));
    const digest = await crypto.subtle.sign('HMAC', key, input);
    input.fill(0);
    return 'hmac256:' + [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  };
}
