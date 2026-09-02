/**
 * Thin Resend API client used only from server code.
 * Reads RESEND_API_KEY from process.env; never exposed to the browser.
 */
const RESEND_BASE = "https://api.resend.com";

export class ResendError extends Error {
  public status: number;
  public body: string;
  constructor(status: number, body: string, message?: string) {
    super(message ?? `Resend error (${status}): ${body.slice(0, 200)}`);
    this.status = status;
    this.body = body;
  }
}

function apiKey(): string {
  const k = process.env.RESEND_API_KEY;
  if (!k)
    throw new ResendError(
      0,
      "",
      "Resend is not configured. Add RESEND_API_KEY as a server secret.",
    );
  return k;
}

async function rq<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${RESEND_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const text = await res.text();
  if (!res.ok) {
    let msg: string | undefined;
    try {
      const j = JSON.parse(text) as { message?: string; name?: string };
      msg = j.message ?? j.name;
    } catch {
      /* raw */
    }
    throw new ResendError(res.status, text, msg);
  }
  return (text ? JSON.parse(text) : {}) as T;
}

export function isResendConfigured(): boolean {
  return !!process.env.RESEND_API_KEY;
}

export interface SendEmailInput {
  from: string;
  to: string;
  replyTo?: string;
  subject: string;
  html: string;
  text?: string;
  tags?: { name: string; value: string }[];
  headers?: Record<string, string>;
}

export async function resendSendEmail(input: SendEmailInput): Promise<{ id: string }> {
  return rq<{ id: string }>("/emails", {
    method: "POST",
    body: JSON.stringify({
      from: input.from,
      to: [input.to],
      reply_to: input.replyTo,
      subject: input.subject,
      html: input.html,
      text: input.text,
      tags: input.tags,
      headers: input.headers,
    }),
  });
}

// -------- Domains --------

export interface ResendDnsRecord {
  record: string;
  name: string;
  type: string;
  value: string;
  ttl?: number | string;
  priority?: number;
  status?: string;
}

export interface ResendDomain {
  id: string;
  name: string;
  status: string;
  records?: ResendDnsRecord[];
  created_at?: string;
  region?: string;
}

export async function resendCreateDomain(
  name: string,
  region = "us-east-1",
): Promise<ResendDomain> {
  return rq<ResendDomain>("/domains", {
    method: "POST",
    body: JSON.stringify({ name, region }),
  });
}

export async function resendGetDomain(id: string): Promise<ResendDomain> {
  return rq<ResendDomain>(`/domains/${encodeURIComponent(id)}`);
}

export async function resendVerifyDomain(id: string): Promise<{ id: string }> {
  return rq<{ id: string }>(`/domains/${encodeURIComponent(id)}/verify`, { method: "POST" });
}

export async function resendListDomains(): Promise<{ data: ResendDomain[] }> {
  return rq<{ data: ResendDomain[] }>("/domains");
}

export async function resendDeleteDomain(id: string): Promise<{ id: string; deleted: boolean }> {
  return rq(`/domains/${encodeURIComponent(id)}`, { method: "DELETE" });
}
