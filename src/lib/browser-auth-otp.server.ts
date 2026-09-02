/* OTP detection/submission and reusable authenticated browser-state capture. */
/* eslint-disable @typescript-eslint/no-explicit-any */
export interface OtpContext {
  detected_type: "email" | "sms" | "authenticator" | "security_question" | "unknown";
  detected_at: string; field_selector?: string; page_text?: string; error?: string; attempt_count: number;
}
export interface CapturedSessionState {
  authenticated_cookies: Array<{ name: string; value: string; domain?: string; path?: string; expires?: number; secure?: boolean; httpOnly?: boolean; sameSite?: string }>;
  session_tokens: Record<string, any>;
  auth_headers: Record<string, string>;
}

export function detectOtpExpression(): string {
  return `(() => {
    const pageText=document.body.innerText.toLowerCase();
    const otpInputs=Array.from(document.querySelectorAll('input[name*="code"], input[placeholder*="code"], input[aria-label*="code"], input[type="text"][maxlength="6"], input[placeholder*="verification"], input[placeholder*="otp"], input[name*="otp"], input[name*="2fa"]'));
    const email=['verification code','email code','check your email','sent to your email'];
    const sms=['text message','sms','phone number','mobile','sent to'];
    const auth=['authenticator','google authenticator','authy','totp','scanning the qr'];
    const security=['security key','security question','recovery code'];
    let detectedType='unknown';
    if(email.some(k=>pageText.includes(k))) detectedType='email'; else if(sms.some(k=>pageText.includes(k))) detectedType='sms'; else if(auth.some(k=>pageText.includes(k))) detectedType='authenticator'; else if(security.some(k=>pageText.includes(k))) detectedType='security_question';
    const suggests=['verification','verify','confirm','2-factor','two-factor','two factor','second factor'].some(k=>pageText.includes(k));
    if(otpInputs.length||suggests) return {detected:true,type:detectedType,hasOtpField:otpInputs.length>0,fieldSelector:otpInputs.length?(otpInputs[0].getAttribute('name')||otpInputs[0].getAttribute('id')||'code_field'):null,pageTextSnippet:pageText.substring(0,200)};
    return {detected:false};
  })()`;
}

export function submitOtpExpression(code: string, fieldSelector?: string): string {
  return `(() => {
    const code=${JSON.stringify(code)}, selector=${JSON.stringify(fieldSelector)};
    let otpField=null;
    if(selector) otpField=document.querySelector(\`input[name="\${selector}"]\`)||document.querySelector(\`#\${selector}\`);
    if(!otpField) otpField=document.querySelector('input[name*="code"], input[placeholder*="code"], input[aria-label*="code"], input[type="text"][maxlength="6"], input[placeholder*="verification"], input[placeholder*="otp"]');
    if(!otpField) return {success:false,error:'Could not find OTP input field'};
    const proto=otpField instanceof HTMLInputElement?HTMLInputElement.prototype:HTMLElement.prototype;
    const setter=Object.getOwnPropertyDescriptor(proto,'value')?.set; if(setter) setter.call(otpField,code); else otpField.value=code;
    otpField.dispatchEvent(new Event('input',{bubbles:true})); otpField.dispatchEvent(new Event('change',{bubbles:true}));
    const controls=Array.from(document.querySelectorAll('button, input[type="submit"], [role="button"]')).filter(el=>el&&!el.disabled&&el.getClientRects().length>0);
    const text=el=>String(el.innerText||el.value||el.getAttribute('aria-label')||'').trim().toLowerCase();
    const submitBtn=controls.find(el=>/^(verify|confirm|continue|submit|next)$/.test(text(el)))||controls.find(el=>/(verify|confirm|continue|submit)/.test(text(el)));
    if(submitBtn){submitBtn.click();return {success:true,action:'clicked_submit'}}
    if(otpField.form){otpField.form.requestSubmit?.();return {success:true,action:'submitted_form'}}
    return {success:true,action:'code_injected_no_submit'};
  })()`;
}

export async function captureSessionStateThroughCdp(client: any, sessionId?: string): Promise<CapturedSessionState> {
  await client.send("Network.enable", {}, sessionId).catch(() => undefined);
  const cookiesResult = await client.send("Network.getAllCookies", {}, sessionId).catch(() => ({ cookies: [] }));
  const cookies = (cookiesResult?.cookies ?? [])
    .filter((c: any) => c?.name && !c.name.includes("_ga") && !c.name.includes("_utm"))
    .map((c: any) => ({ name:c.name,value:c.value,domain:c.domain,path:c.path,expires:c.expires,secure:c.secure,httpOnly:c.httpOnly,sameSite:c.sameSite }));
  const storageResult = await client.send("Runtime.evaluate", {
    expression: `(() => { const read=s=>{const o={};for(let i=0;i<s.length;i++){const k=s.key(i);if(k)o[k]=s.getItem(k)}return o};return {localStorage:read(localStorage),sessionStorage:read(sessionStorage)}})()`,
    returnByValue: true,
  }, sessionId).catch(() => null);
  return {
    authenticated_cookies: cookies,
    session_tokens: { captured_at: new Date().toISOString(), storage: storageResult?.result?.value ?? { localStorage:{}, sessionStorage:{} } },
    auth_headers: {},
  };
}

export function injectSessionCookiesExpression(cookies: Array<{ name: string; value: string }>): string {
  return `(() => { const cookies=${JSON.stringify(cookies)};let injected=0;for(const cookie of cookies){try{document.cookie=\`\${cookie.name}=\${cookie.value}; path=/; SameSite=Lax\`;injected++}catch{}}window.location.reload();return {injected,total:cookies.length}; })()`;
}

export function checkAuthenticationStatusExpression(): string {
  return `(() => {
    const url=window.location.href.toLowerCase(), text=document.body.innerText.toLowerCase();
    const loginKeywords=['sign in','login','log in','sign up','create account','enter password'];
    const protectedKeywords=['dashboard','workspace','account','settings','profile'];
    const onLoginPage=loginKeywords.some(k=>url.includes(k)||text.includes(k));
    const onProtectedPage=protectedKeywords.some(k=>url.includes(k)||text.includes(k));
    const errorElements=document.querySelectorAll('[role="alert"], .error, .alert-danger');
    const hasError=errorElements.length>0||text.includes('invalid')||text.includes('failed');
    return {authenticated:!onLoginPage&&onProtectedPage&&!hasError,onLoginPage,onProtectedPage,hasError,url,title:document.title};
  })()`;
}
