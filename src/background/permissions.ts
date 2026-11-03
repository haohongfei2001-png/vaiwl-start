import { invalidateBindings, session } from './session.js';
export const CONNECTION: chrome.permissions.Permissions = { permissions: ['scripting', 'webNavigation'], origins: ['https://chatgpt.com/*'] };
export async function capabilities() {
  const [chatgpt, history] = await Promise.all([chrome.permissions.contains(CONNECTION), chrome.permissions.contains({ permissions: ['history'] })]);
  return { chatgpt, history, sourceGate: 'LOCAL_WORKSPACE_READY', localHistory: true, startNavigationActivity: chatgpt, localProjectCandidates: chatgpt, nativeProjectLocalGrouping: chatgpt, verifiedScope: false, nativeProjectMembership: false, nativeNone: false, reasons: ['current-context-unverified', 'account-project-membership-unverified', 'positive-none-unverified'] };
}
export async function synchronizePermissions(captureEnabled: boolean): Promise<void> {
  const connected = captureEnabled && await chrome.permissions.contains(CONNECTION);
  if (!connected) {
    const previous = await session();
    await invalidateBindings();
    await chrome.storage.session.remove('sourceStatus');
    if (chrome.scripting) {
      try { await chrome.scripting.unregisterContentScripts({ ids: ['vaiwl-start-chatgpt'] }); } catch { /* not registered / permission already revoked */ }
    }
    // Existing isolated collectors stop on this bounded command; a rejected sender has no writes either.
    // Known bindings remain addressable after host permission is gone; do not depend on a URL query.
    await Promise.allSettled(Object.values(previous.bindings).map(binding => chrome.tabs.sendMessage(binding.tabId, { protocol: 'vaiwl-start-collector/1', command: 'STOP' }, { documentId: binding.documentId })));
    return;
  }
  const scripts = await chrome.scripting.getRegisteredContentScripts({ ids: ['vaiwl-start-chatgpt'] });
  if (!scripts.length) await chrome.scripting.registerContentScripts([{ id: 'vaiwl-start-chatgpt', matches: ['https://chatgpt.com/*'], js: ['content.js'], allFrames: false, runAt: 'document_idle', world: 'ISOLATED', persistAcrossSessions: true }]);
  // A click on Connect takes effect on existing ChatGPT tabs too, with no page reload.
  const tabs = await chrome.tabs.query({ url: 'https://chatgpt.com/*' });
  await Promise.allSettled(tabs.filter(t => typeof t.id === 'number').map(t => chrome.scripting.executeScript({ target: { tabId: t.id!, allFrames: false }, files: ['content.js'], world: 'ISOLATED' })));
}
