/** pendingUrl is authoritative while a tab we created is still navigating. */
export function temporaryPageTarget(tab:Pick<chrome.tabs.Tab,'url'|'pendingUrl'>):string|undefined {
  return tab.pendingUrl || tab.url;
}
/** Keep ownership through the provider's ordinary login/verification redirects. */
export function nativeRecoveryPage(href:string):'LOGIN_REQUIRED'|'VERIFICATION_REQUIRED'|null {
  let url:URL;try{url=new URL(href);}catch{return null;}
  if(url.protocol!=='https:')return null;
  if(['auth.openai.com','auth0.openai.com'].includes(url.hostname))return 'LOGIN_REQUIRED';
  if(url.hostname!=='chatgpt.com')return null;
  if(/^\/(?:auth(?:\/|$)|login(?:\/|$))/.test(url.pathname))return 'LOGIN_REQUIRED';
  if(/^\/(?:cdn-cgi\/challenge-platform(?:\/|$)|challenge(?:\/|$)|verify(?:\/|$))/.test(url.pathname))return 'VERIFICATION_REQUIRED';
  return null;
}
