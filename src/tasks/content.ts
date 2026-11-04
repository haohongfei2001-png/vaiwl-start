import { createLocalPrincipalReader } from '../collectors/chatgpt/identity.js';
import { validatePacket } from './source.js';
import type { SourcePacket } from './types.js';
const PROTOCOL = 'vaiwl-tasks/1';
const reader = createLocalPrincipalReader();
let refreshing: Promise<{token:string}> | null = null;
let pinnedPrincipal: string | null = null;
let stopped = false;
function stop() { stopped=true;window.postMessage({channel:'vaiwl-task-stop/1'}, 'https://chatgpt.com'); }
async function identity(): Promise<{token:string}> {
  if(stopped)throw Error('DISABLED');
  if(refreshing)return refreshing;
  refreshing=(async()=>{
    const local=await reader.read();
    if(stopped)throw Error('DISABLED');
    const changed=!!local.principalKey&&!!pinnedPrincipal&&local.principalKey!==pinnedPrincipal;
    const result=await chrome.runtime.sendMessage({protocol:PROTOCOL,command:'HELLO',principalKey:local.principalKey,expiresAt:local.expiresAt});
    // A document is pinned to its initial principal. A fresh identity observation
    // may switch the visible account, but cannot relabel this document's replies.
    if(changed){stop();throw Error('STALE_DOCUMENT');}
    if(['DISABLED','PERMISSION_REQUIRED'].includes(result?.code))stop();
    if(stopped||!result?.ok||!result.data?.token)throw Error('IDENTITY_UNAVAILABLE');
    pinnedPrincipal ||= local.principalKey;
    return result.data;
  })();
  try{return await refreshing;}finally{refreshing=null;}
}
const initialIdentity=identity().catch(()=>null);
let chain = Promise.resolve();
window.addEventListener('message', event => {
  if(stopped||event.source!==window||event.origin!=='https://chatgpt.com')return;
  if(event.data?.channel==='vaiwl-task-init/1'){window.postMessage({channel:'vaiwl-task-ready/1'},'https://chatgpt.com');return;}
  if(event.data?.channel!=='vaiwl-task-source/1')return;
  let packet: SourcePacket;
  try { packet=validatePacket(event.data.packet);if(packet.pageHref!==location.href)return; } catch { return; }
  chain=chain.catch(()=>{}).then(async()=>{
    await initialIdentity;
    // Verify after the native response too, so switching an account in this same
    // document cannot put late old output into the new account's local cache.
    const binding=await identity();
    if(stopped||location.href!==packet.pageHref)return;
    const reply=await chrome.runtime.sendMessage({protocol:PROTOCOL,command:'OBSERVE',token:binding.token,packet});
    if(['DISABLED','PERMISSION_REQUIRED'].includes(reply?.code))stop();
    if(reply?.code==='STALE_DOCUMENT'){
      const fresh=await identity();
      if(!stopped&&location.href===packet.pageHref)await chrome.runtime.sendMessage({protocol:PROTOCOL,command:'OBSERVE',token:fresh.token,packet});
    }
  }).catch(()=>{});
});
window.postMessage({channel:'vaiwl-task-ready/1'},'https://chatgpt.com');
document.addEventListener('visibilitychange',()=>{if(!stopped&&!document.hidden)void identity().catch(()=>{});});
chrome.runtime.onMessage.addListener((message,sender,respond)=>{if(sender.id===chrome.runtime.id&&message?.protocol===PROTOCOL&&message.event==='stop'){stop();respond({ok:true});}});
