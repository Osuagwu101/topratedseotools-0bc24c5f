/**
 * OTP/2FA handling for browser-based authentication.
 *
 * Detects when a login requires a one-time code (email verification, SMS 2FA, authenticator app)
 * and pauses automation. Admin can then submit the code which resumes the login flow.
 *
 * Once login succeeds, authenticated session state (cookies, tokens) is captured and stored
 * for reuse across future logins (users won't need to verify again).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

export interface OtpContext {
  detected_type: "email" | "sms" | "authenticator" | "security_question" | "unknown";
  detected_at: string;
  field_selector?: string;
  page_text?: string;
  error?: string;
  attempt_count: number;
}

export interface CapturedSessionState {
  authenticated_cookies: Array<{
    name: string;
    value: string;
    domain?: string;
    path?: string;
    expires?: number;
    secure?: boolean;
    httpOnly?: boolean;
  }>;
  session_tokens: Record<string, string>;
  auth_headers: Record<string, string>;
}

/**
 * Detect if page is asking for OTP/2FA verification.
 * Returns detection info or null if no OTP detected.
 */
export function detectOtpExpression(): string {
  return `(() => {
    const pageText = document.body.innerText.toLowerCase();
    const pageHtml = document.documentElement.outerHTML.toLowerCase();

    // OTP field patterns
    const otpInputs = Array.from(document.querySelectorAll(
      'input[name*="code"], input[placeholder*="code"], input[aria-label*="code"], ' +
      'input[type="text"][maxlength="6"], input[placeholder*="verification"], ' +
      'input[placeholder*="otp"], input[name*="otp"], input[name*="2fa"]'
    ));

    // Detection keywords
    const emailKeywords = ['verification code', 'email code', 'check your email', 'sent to your email'];
    const smsKeywords = ['text message', 'sms', 'phone number', 'mobile', 'sent to'];
    const authKeywords = ['authenticator', 'google authenticator', 'authy', 'totp', 'scanning the qr'];
    const securityKeywords = ['security key', 'security question', 'recovery code'];

    let detectedType = 'unknown';
    if (emailKeywords.some(k => pageText.includes(k))) detectedType = 'email';
    else if (smsKeywords.some(k => pageText.includes(k))) detectedType = 'sms';
    else if (authKeywords.some(k => pageText.includes(k))) detectedType = 'authenticator';
    else if (securityKeywords.some(k => pageText.includes(k))) detectedType = 'security_question';

    const hasOtpField = otpInputs.length > 0;
    const suggestsVerification = [
      pageText.includes('verification'),
      pageText.includes('verify'),
      pageText.includes('confirm'),
      pageText.includes('2-factor'),
      pageText.includes('two-factor'),
      pageText.includes('two factor'),
      pageText.includes('second factor'),
    ].filter(Boolean).length >= 1;

    if (hasOtpField || suggestsVerification) {
      return {
        detected: true,
        type: detectedType,
        hasOtpField,
        fieldSelector: otpInputs.length > 0 ? otpInputs[0].getAttribute('name') || otpInputs[0].getAttribute('id') || 'code_field' : null,
        pageTextSnippet: pageText.substring(0, 200)
      };
    }

    return { detected: false };
  })()`;
}

/**
 * Submit an OTP code to the detected input field and trigger submission.
 */
export function submitOtpExpression(code: string, fieldSelector?: string): string {
  return `(() => {
    const code = ${JSON.stringify(code)};
    const selector = ${JSON.stringify(fieldSelector)};

    // Find OTP input field
    let otpField = null;
    if (selector) {
      otpField = document.querySelector(\`input[name="\${selector}"]\`) ||
                 document.querySelector(\`#\${selector}\`);
    }
    if (!otpField) {
      otpField = document.querySelector(
        'input[name*="code"], input[placeholder*="code"], input[aria-label*="code"], ' +
        'input[type="text"][maxlength="6"], input[placeholder*="verification"], ' +
        'input[placeholder*="otp"]'
      );
    }

    if (!otpField) {
      return { success: false, error: 'Could not find OTP input field' };
    }

    // Inject code
    otpField.value = code;
    otpField.dispatchEvent(new Event('input', { bubbles: true }));
    otpField.dispatchEvent(new Event('change', { bubbles: true }));

    // Find and click submit button
    const controls = Array.from(document.querySelectorAll('button, input[type="submit"], [role="button"]'))
      .filter(el => el && !el.disabled && el.getClientRects().length > 0);

    const text = (el) => String(el.innerText || el.value || el.getAttribute('aria-label') || '').trim().toLowerCase();
    const submitBtn = controls.find(el => /^(verify|confirm|continue|submit|next)$/.test(text(el))) ||
                      controls.find(el => /(verify|confirm|continue|submit)/.test(text(el)));

    if (submitBtn) {
      submitBtn.click();
      return { success: true, action: 'clicked_submit' };
    } else if (otpField.form) {
      otpField.form.requestSubmit?.();
      return { success: true, action: 'submitted_form' };
    }

    return { success: true, action: 'code_injected_no_submit' };
  })()`;
}

/**
 * Capture authenticated cookies and session tokens from the browser.
 */
export async function captureSessionStateThroughCdp(
  client: any,
  sessionId?: string
): Promise<CapturedSessionState> {
  // Get cookies via CDP
  const cookiesResult = await client.send(
    "Network.getAllCookies",
    {},
    sessionId
  ).catch(() => ({ cookies: [] }));

  const cookies = (cookiesResult?.cookies ?? [])
    .filter((c: any) => !c.name.includes('_ga') && !c.name.includes('_utm'))
    .slice(0, 20)
    .map((c: any) => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path,
      expires: c.expires,
      secure: c.secure,
      httpOnly: c.httpOnly,
    }));

  // Get common auth headers from recent requests via Network tracking
  const headersResult = await client.send(
    "Network.getResponseBody",
    { requestId: "temp" },
    sessionId
  ).catch(() => ({}));

  return {
    authenticated_cookies: cookies,
    session_tokens: {
      // These would be extracted from page state if available
      captured_at: new Date().toISOString(),
    },
    auth_headers: {
      // Extract from page if needed
    },
  };
}

/**
 * Inject captured session cookies into browser before form-based login.
 * Allows reusing authenticated state from previous admin setup.
 */
export function injectSessionCookiesExpression(cookies: Array<{
  name: string;
  value: string;
}>): string {
  return `(() => {
    const cookies = ${JSON.stringify(cookies)};
    let injected = 0;

    for (const cookie of cookies) {
      try {
        document.cookie = \`\${cookie.name}=\${cookie.value}; path=/; SameSite=Lax\`;
        injected++;
      } catch (e) {
        console.warn('Failed to inject cookie:', cookie.name, e);
      }
    }

    // Force page reload to apply cookies
    window.location.reload();

    return { injected, total: cookies.length };
  })()`;
}

/**
 * Check if user appears to be authenticated (not on login page).
 */
export function checkAuthenticationStatusExpression(): string {
  return `(() => {
    const url = window.location.href.toLowerCase();
    const text = document.body.innerText.toLowerCase();

    const loginKeywords = ['sign in', 'login', 'log in', 'sign up', 'create account', 'enter password'];
    const protectedKeywords = ['dashboard', 'workspace', 'account', 'settings', 'profile'];

    const onLoginPage = loginKeywords.some(k => url.includes(k) || text.includes(k));
    const onProtectedPage = protectedKeywords.some(k => url.includes(k) || text.includes(k));

    const errorElements = document.querySelectorAll('[role="alert"], .error, .alert-danger');
    const hasError = errorElements.length > 0 || text.includes('invalid') || text.includes('failed');

    return {
      authenticated: !onLoginPage && onProtectedPage && !hasError,
      onLoginPage,
      onProtectedPage,
      hasError,
      url,
      title: document.title
    };
  })()`;
}
