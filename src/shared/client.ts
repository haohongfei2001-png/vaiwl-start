const PROTOCOL = 'vaiwl-start-internal/1';
let revision = 0;
export async function request(command: string, payload: Record<string, unknown> = {}): Promise<any> {
  const { expectedRevision = revision, ...fields } = payload;
  const response = await chrome.runtime.sendMessage({ protocol: PROTOCOL, operationId: crypto.randomUUID(), expectedRevision, command, payload: fields });
  if (!response || response.protocol !== PROTOCOL || typeof response.ok !== 'boolean') throw new Error('INVALID_RESPONSE');
  if (!response.ok) throw new Error(response.code || 'REQUEST_FAILED');
  if (Number.isSafeInteger(response.data?.revision)) revision = response.data.revision;
  return response.data;
}
export function subscribeRevision(callback: (revision: number) => void): () => void {
  const listener = (message: any, sender: chrome.runtime.MessageSender) => {
    if (sender.id === chrome.runtime.id && message?.protocol === PROTOCOL && message?.event === 'revision' && Number.isSafeInteger(message.revision)) callback(message.revision);
  };
  chrome.runtime.onMessage.addListener(listener);
  return () => chrome.runtime.onMessage.removeListener(listener);
}
