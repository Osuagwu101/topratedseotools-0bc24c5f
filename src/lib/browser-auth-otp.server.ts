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

export function cookieBelongsToPageHost(
  cookieDomain: string | null | undefined,
  pageHost: string,
): boolean {
  const host = pageHost.trim().toLowerCase().replace(/^\.+|\.+$/g, "");
  const domain = String(cookieDomain ?? host)
    .trim()
    .toLowerCase()
    .replace(/^\.+|\.+$/g, "");
  if (!host || !domain) return false;
  return host === domain || host.endsWith(`.${domain}`);
}

export function detectOtpExpression(): string {
  return `(() => {
    const visible=(el)=>!!el&&!el.disabled&&el.getClientRects().length>0;
    const selectors=[
      'input[autocomplete="one-time-code"]',
      'input[name*="otp" i]',
      'input[id*="otp" i]',
      'input[name*="code" i]',
      'input[id*="code" i]',
      'input[placeholder*="code" i]',
      'input[aria-label*="code" i]',
      'input[placeholder*="verification" i]',
      'input[name*="verification" i]',
      'input[name*="2fa" i]',
      'input[id*="2fa" i]',
      'input[name*="recovery" i]',
      'input[placeholder*="recovery" i]',
      'input[inputmode="numeric"][maxlength="4"]',
      'input[inputmode="numeric"][maxlength="6"]',
      'input[inputmode="numeric"][maxlength="8"]'
    ];
    const otpInputs=Array.from(document.querySelectorAll(selectors.join(','))).filter(visible);
    const digitInputs=Array.from(document.querySelectorAll('input[maxlength="1"]')).filter(
      el=>visible(el)&&(/numeric|tel/i.test(String(el.getAttribute('inputmode')||el.getAttribute('type')||''))||/code|otp|verification/i.test(String(el.getAttribute('name')||el.getAttribute('id')||el.getAttribute('aria-label')||'')))
    );
    const fields=otpInputs.length?otpInputs:(digitInputs.length>=4?digitInputs:[]);
    if(!fields.length) return {detected:false};

    const pageText=(document.body?.innerText||'').toLowerCase();
    const email=['verification code','email code','check your email','sent to your email','email verification'];
    const sms=['text message','sms','phone number','mobile','sent to your phone'];
    const auth=['authenticator','google authenticator','authy','totp','scan the qr'];
    const security=['security key','security question','recovery code'];
    let detectedType='unknown';
    if(email.some(k=>pageText.includes(k))) detectedType='email';
    else if(sms.some(k=>pageText.includes(k))) detectedType='sms';
    else if(auth.some(k=>pageText.includes(k))) detectedType='authenticator';
    else if(security.some(k=>pageText.includes(k))) detectedType='security_question';

    const field=fields[0];
    const id=field.getAttribute('id');
    const name=field.getAttribute('name');
    const fieldSelector=id?('id:'+id):(name?('name:'+name):null);
    return {
      detected:true,
      type:detectedType,
      hasOtpField:true,
      fieldSelector,
      digitFieldCount:digitInputs.length>=4?digitInputs.length:0,
      pageTextSnippet:pageText.substring(0,200)
    };
  })()`;
}

export function submitOtpExpression(code: string, fieldSelector?: string): string {
  return `(async () => {
    const code=${JSON.stringify(code)}, selector=${JSON.stringify(fieldSelector)};
    const visible=(el)=>!!el&&!el.disabled&&el.getClientRects().length>0;
    const setValue=(el,value)=>{
      const proto=el instanceof HTMLInputElement?HTMLInputElement.prototype:HTMLElement.prototype;
      const setter=Object.getOwnPropertyDescriptor(proto,'value')?.set;
      if(setter) setter.call(el,value); else el.value=value;
      el.dispatchEvent(new Event('input',{bubbles:true}));
      el.dispatchEvent(new Event('change',{bubbles:true}));
    };
    const findStored=(token)=>{
      if(!token) return null;
      if(token.startsWith('id:')) return document.getElementById(token.slice(3));
      if(token.startsWith('name:')) return document.getElementsByName(token.slice(5))[0]||null;
      return document.getElementById(token)||document.getElementsByName(token)[0]||null;
    };

    const digitInputs=Array.from(document.querySelectorAll('input[maxlength="1"]')).filter(
      el=>visible(el)&&(/numeric|tel/i.test(String(el.getAttribute('inputmode')||el.getAttribute('type')||''))||/code|otp|verification/i.test(String(el.getAttribute('name')||el.getAttribute('id')||el.getAttribute('aria-label')||'')))
    );
    let activeField=null;
    if(digitInputs.length>=4 && code.length<=digitInputs.length){
      [...code].forEach((char,index)=>setValue(digitInputs[index],char));
      activeField=digitInputs[0];
    } else {
      let otpField=findStored(selector);
      if(!visible(otpField)) {
        otpField=Array.from(document.querySelectorAll([
          'input[autocomplete="one-time-code"]',
          'input[name*="otp" i]',
          'input[id*="otp" i]',
          'input[name*="code" i]',
          'input[id*="code" i]',
          'input[placeholder*="code" i]',
          'input[aria-label*="code" i]',
          'input[placeholder*="verification" i]',
          'input[name*="verification" i]',
          'input[name*="2fa" i]',
          'input[id*="2fa" i]',
          'input[name*="recovery" i]',
          'input[placeholder*="recovery" i]',
          'input[inputmode="numeric"][maxlength="4"]',
          'input[inputmode="numeric"][maxlength="6"]',
          'input[inputmode="numeric"][maxlength="8"]'
        ].join(','))).find(visible)||null;
      }
      if(!otpField) return {success:false,error:'Could not find OTP input field'};
      setValue(otpField,code);
      activeField=otpField;
    }

    await new Promise(resolve=>setTimeout(resolve,100));
    const controls=Array.from(document.querySelectorAll('button, input[type="submit"], [role="button"]')).filter(visible);
    const text=el=>String(el.innerText||el.value||el.getAttribute('aria-label')||'').trim().toLowerCase();
    const submitBtn=controls.find(el=>/^(verify|confirm|continue|submit|next)$/.test(text(el)))||controls.find(el=>/(verify|confirm|continue|submit)/.test(text(el)));
    if(submitBtn){submitBtn.click();return {success:true,action:'clicked_submit'}}
    if(activeField?.form){activeField.form.requestSubmit?.();return {success:true,action:'submitted_form'}}
    return {success:true,action:'code_injected_no_submit'};
  })()`;
}

export async function captureSessionStateThroughCdp(client: any, sessionId?: string): Promise<CapturedSessionState> {
  await client.send("Network.enable", {}, sessionId).catch(() => undefined);

  const hostResult = await client
    .send(
      "Runtime.evaluate",
      { expression: "location.hostname", returnByValue: true },
      sessionId,
    )
    .catch(() => null);
  const pageHost =
    typeof hostResult?.result?.value === "string"
      ? hostResult.result.value.trim().toLowerCase()
      : "";

  const cookiesResult = await client.send("Network.getAllCookies", {}, sessionId).catch(() => ({ cookies: [] }));
  const cookies = (cookiesResult?.cookies ?? [])
    .filter(
      (c: any) =>
        pageHost &&
        c?.name &&
        !c.name.includes("_ga") &&
        !c.name.includes("_utm") &&
        cookieBelongsToPageHost(c.domain, pageHost),
    )
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
    const url=window.location.href.toLowerCase();
    const path=window.location.pathname.toLowerCase();
    const text=document.body?.innerText?.toLowerCase()||'';
    const visible=(el)=>!!el&&!el.disabled&&el.getClientRects().length>0;
    const visiblePassword=Array.from(document.querySelectorAll('input[type="password"], input[autocomplete="current-password"]')).some(visible);
    const visibleEmail=Array.from(document.querySelectorAll('input[type="email"], input[autocomplete="username"]')).some(visible);
    const loginPath=/(^|\\/)(login|signin|sign-in|register|signup|sign-up|auth)(\\/|$)/.test(path);
    const loginForm=visiblePassword&&(visibleEmail||Array.from(document.querySelectorAll('button,input[type="submit"]')).some(el=>/sign in|log in|login/i.test(String(el.innerText||el.value||''))));
    const protectedPath=/(^|\\/)(dashboard|workspace|account|settings|profile|humanizer|documents|editor)(\\/|$)/.test(path);
    const accountUi=!!document.querySelector('[href*="/account"], [href*="/settings"], [href*="/profile"], [data-testid*="account" i], [aria-label*="account" i]');
    const authError=Array.from(document.querySelectorAll('[role="alert"], .error, .alert-danger')).some(el=>visible(el)&&/invalid|incorrect|failed|expired|unauthorized|wrong password|not match/i.test(String(el.textContent||'')));
    const humanVerification=/verify you are human|human verification|captcha|security check|checking your browser|challenge/i.test(text);
    const authenticated=!loginPath&&!loginForm&&!authError&&!humanVerification&&(protectedPath||accountUi);
    return {
      authenticated,
      onLoginPage:loginPath||loginForm,
      onProtectedPage:protectedPath||accountUi,
      hasError:authError,
      humanVerification,
      url,
      title:document.title
    };
  })()`;
}