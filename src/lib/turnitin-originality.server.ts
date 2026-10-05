/*
 * Server-only Originality Reports client for the Turnitin workspace.
 *
 * This module intentionally mirrors only the authenticated workflow observed
 * from the user's paid Originality Reports account:
 *   POST /user/upload
 *   GET  /user/submissions-status
 *   GET  /user/download/:id/{similarity|ai}
 *
 * It does not automate login, bypass challenges, or expose upstream session
 * state to customers.
 */
import {
  decryptOriginalitySession,
  encryptOriginalitySession,
  originalityCookieHeader,
  parseOriginalitySession,
  TURNITIN_ORIGINALITY_AUTH_COOKIE,
  type OriginalitySessionState,
} from "@/lib/turnitin-originality-session.server";

export const ORIGINALITY_ORIGIN = "https://www.originality.report";
const MAX_REPORT_BYTES = 100 * 1024 * 1024;

type AdminClient = any;

export class OriginalityAdapterError extends Error {
  code: string;
  status?: number;

  constructor(code: string, message: string, status?: number) {
    super(message);
    this.name = "OriginalityAdapterError";
    this.code = code;
    this.status = status;
  }
}

type SessionContext = {
  state: OriginalitySessionState;
  dirty: boolean;
};

export type OriginalityUploadOptions = {
  filename: string;
  mimeType: string;
  bytes: Uint8Array;
  uploadToken: string;
  excludeBibliography: boolean;
  excludeQuotes: boolean;
  excludeCitations: boolean;
  excludeSmallMatches: boolean;
  smallMatchMode: "words" | "percent";
  smallMatchThreshold: number | null;
  reportView: "sources" | "match_groups";
  reportFormat?: string | null;
  reportTitle: string;
  authorFirstName?: string | null;
  authorLastName?: string | null;
  folderId?: string | null;
};

export type OriginalityUploadResult = {
  submissionId: string;
  message: string | null;
};

export type OriginalitySubmission = {
  id: string;
  status: string;
  aiPercentage: number | null;
  similarityPercentage: number | null;
  aiReportExists: boolean;
  similarityReportExists: boolean;
  aiUnavailableReason: string | null;
  wordCount: number | null;
  submittedAt: string | null;
  aiCompletedAt: string | null;
  similarityCompletedAt: string | null;
  refundReason: string | null;
  viewerAvailable: boolean;
  viewerUrl: string | null;
};

function upstreamUrl(path: string): string {
  return new URL(path, ORIGINALITY_ORIGIN).toString();
}

function lowerLocation(response: Response): string {
  return String(response.headers.get("location") ?? "").toLowerCase();
}

function isLoginRedirect(response: Response): boolean {
  return (
    response.status >= 300 &&
    response.status < 400 &&
    lowerLocation(response).includes("/accounts/login")
  );
}

function boolish(value: unknown): boolean {
  if (value === true || value === 1 || value === "1") return true;
  const v = String(value ?? "").trim().toLowerCase();
  return v === "true" || v === "yes";
}

function nullablePercent(value: unknown): number | null {
  if (value == null) return null;
  const text = String(value).trim();
  if (!text || /^(n\/?a|none|null|unavailable|pending)$/i.test(text)) return null;
  const n = Number(text.replace("%", ""));
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null;
}

function nullableInteger(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
}

function readSetCookieHeaders(headers: Headers): string[] {
  const extended = headers as Headers & { getSetCookie?: () => string[] };
  if (typeof extended.getSetCookie === "function") {
    return extended.getSetCookie();
  }
  const single = headers.get("set-cookie");
  return single ? [single] : [];
}

function mergeKnownSessionCookies(
  context: SessionContext,
  response: Response,
): void {
  const knownNames = new Set(context.state.cookies.map((cookie) => cookie.name));
  knownNames.add(TURNITIN_ORIGINALITY_AUTH_COOKIE);

  for (const line of readSetCookieHeaders(response.headers)) {
    const pair = line.split(";", 1)[0] ?? "";
    const eq = pair.indexOf("=");
    if (eq <= 0) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1);
    if (!knownNames.has(name) || !value) continue;

    const existing = context.state.cookies.find((cookie) => cookie.name === name);
    if (existing) {
      if (existing.value !== value) {
        existing.value = value;
        context.dirty = true;
      }
    } else if (name === TURNITIN_ORIGINALITY_AUTH_COOKIE) {
      context.state.cookies.push({
        name,
        value,
        domain: ".originality.report",
        path: "/",
        secure: true,
        httpOnly: true,
        sameSite: "Lax",
      });
      context.dirty = true;
    }
  }
}

async function loadSession(admin: AdminClient): Promise<SessionContext> {
  const { data: row, error } = await admin
    .from("turnitin_originality_authorized_session")
    .select("encrypted_payload, status")
    .eq("id", "primary")
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!row || row.status !== "stored") {
    throw new OriginalityAdapterError(
      "SESSION_NOT_CONFIGURED",
      "Originality Reports authorised session is not configured.",
    );
  }

  const plaintext = decryptOriginalitySession(String(row.encrypted_payload));
  return {
    state: parseOriginalitySession(plaintext),
    dirty: false,
  };
}

async function persistRotatedSession(
  admin: AdminClient,
  context: SessionContext,
): Promise<void> {
  if (!context.dirty) return;
  const encrypted = encryptOriginalitySession(JSON.stringify(context.state));
  const { error } = await admin
    .from("turnitin_originality_authorized_session")
    .update({
      encrypted_payload: encrypted,
      updated_at: new Date().toISOString(),
    })
    .eq("id", "primary")
    .eq("status", "stored");
  if (error) throw new Error(error.message);
  context.dirty = false;
}

async function sessionFetch(
  context: SessionContext,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Cookie", originalityCookieHeader(context.state));
  headers.set("Accept", headers.get("Accept") ?? "application/json, text/plain, */*");
  headers.set("Referer", ORIGINALITY_ORIGIN + "/dashboard");
  if ((init.method ?? "GET").toUpperCase() !== "GET") {
    headers.set("Origin", ORIGINALITY_ORIGIN);
  }

  const response = await fetch(upstreamUrl(path), {
    ...init,
    headers,
    redirect: "manual",
  });
  mergeKnownSessionCookies(context, response);

  if (isLoginRedirect(response) || response.status === 401) {
    throw new OriginalityAdapterError(
      "SESSION_EXPIRED",
      "Originality Reports session has expired. Replace it in Admin.",
      response.status,
    );
  }
  if (response.status === 403) {
    throw new OriginalityAdapterError(
      "UPSTREAM_FORBIDDEN",
      "Originality Reports rejected the authorised session.",
      response.status,
    );
  }
  return response;
}

export async function validateOriginalitySessionState(
  state: OriginalitySessionState,
): Promise<{
  ok: true;
  availableSlots: number | null;
  sessionState: OriginalitySessionState;
}> {
  const context: SessionContext = {
    state: JSON.parse(JSON.stringify(state)) as OriginalitySessionState,
    dirty: false,
  };
  const response = await sessionFetch(
    context,
    `/user/submissions-status?_=${Date.now()}`,
  );

  if (!response.ok) {
    throw new OriginalityAdapterError(
      "SESSION_TEST_FAILED",
      `Originality Reports session test returned HTTP ${response.status}.`,
      response.status,
    );
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new OriginalityAdapterError(
      "SESSION_TEST_FAILED",
      "Originality Reports did not return the authenticated dashboard JSON.",
    );
  }

  const json = (await response.json()) as Record<string, unknown>;
  if (json.success === false) {
    throw new OriginalityAdapterError(
      "SESSION_TEST_FAILED",
      String(json.error ?? "Originality Reports session test failed."),
    );
  }

  return {
    ok: true,
    availableSlots: nullableInteger(json.available_slots),
    sessionState: context.state,
  };
}

export async function testStoredOriginalitySession(
  admin: AdminClient,
): Promise<{ ok: true; availableSlots: number | null }> {
  const context = await loadSession(admin);
  const response = await sessionFetch(
    context,
    `/user/submissions-status?_=${Date.now()}`,
  );

  if (!response.ok) {
    throw new OriginalityAdapterError(
      "SESSION_TEST_FAILED",
      `Originality Reports session test returned HTTP ${response.status}.`,
      response.status,
    );
  }
  const json = (await response.json()) as Record<string, unknown>;
  await persistRotatedSession(admin, context);

  if (json.success === false) {
    throw new OriginalityAdapterError(
      "SESSION_TEST_FAILED",
      String(json.error ?? "Originality Reports session test failed."),
    );
  }

  return {
    ok: true,
    availableSlots: nullableInteger(json.available_slots),
  };
}

function validateSmallMatch(options: OriginalityUploadOptions): void {
  if (!options.excludeSmallMatches) return;
  const n = options.smallMatchThreshold;
  if (n == null || !Number.isInteger(n)) {
    throw new OriginalityAdapterError(
      "INVALID_OPTIONS",
      "A small-match threshold is required when small-match exclusion is enabled.",
    );
  }
  const [lo, hi] =
    options.smallMatchMode === "percent" ? [1, 50] : [8, 200];
  if (n < lo || n > hi) {
    throw new OriginalityAdapterError(
      "INVALID_OPTIONS",
      `The small-match threshold must be between ${lo} and ${hi} ${options.smallMatchMode === "percent" ? "%" : "words"}.`,
    );
  }
}

function makeUploadForm(options: OriginalityUploadOptions): FormData {
  validateSmallMatch(options);
  const form = new FormData();
  const blob = new Blob([options.bytes], { type: options.mimeType });

  form.append("file", blob, options.filename);
  form.append("exclude_bibliography", String(options.excludeBibliography));
  form.append("exclude_quotes", String(options.excludeQuotes));

  if (options.reportFormat) {
    form.append("report_format", options.reportFormat);
  }

  form.append("report_view", options.reportView);
  form.append("exclude_citations", String(options.excludeCitations));
  form.append("exclude_small_matches", String(options.excludeSmallMatches));
  form.append("small_match_mode", options.smallMatchMode);
  if (options.excludeSmallMatches && options.smallMatchThreshold != null) {
    form.append("small_match_threshold", String(options.smallMatchThreshold));
  }

  const title = options.reportTitle.trim() || options.filename;
  form.append("report_title", title);
  form.append(
    "author_first_name",
    options.authorFirstName?.trim() || "Test",
  );
  form.append(
    "author_last_name",
    options.authorLastName?.trim() || "Author",
  );
  form.append("folder_id", options.folderId?.trim() || "");
  form.append("upload_token", options.uploadToken);
  return form;
}

async function uploadAttempt(
  context: SessionContext,
  options: OriginalityUploadOptions,
): Promise<Response> {
  return sessionFetch(context, "/user/upload", {
    method: "POST",
    body: makeUploadForm(options),
    headers: {
      "X-Requested-With": "XMLHttpRequest",
      Accept: "application/json",
    },
  });
}

export async function submitOriginalityDocument(
  admin: AdminClient,
  options: OriginalityUploadOptions,
): Promise<OriginalityUploadResult> {
  const context = await loadSession(admin);
  let response: Response | null = null;
  let lastNetworkError: unknown = null;

  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
    }
    try {
      response = await uploadAttempt(context, options);
      lastNetworkError = null;
      break;
    } catch (error) {
      if (error instanceof OriginalityAdapterError) throw error;
      lastNetworkError = error;
    }
  }

  if (!response) {
    throw new OriginalityAdapterError(
      "NETWORK_ERROR",
      `Originality Reports upload failed after three attempts: ${
        lastNetworkError instanceof Error ? lastNetworkError.message : "network error"
      }`,
    );
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new OriginalityAdapterError(
      "UPLOAD_BAD_RESPONSE",
      `Originality Reports upload returned HTTP ${response.status} instead of JSON.`,
      response.status,
    );
  }

  const json = (await response.json()) as {
    success?: boolean;
    submission_id?: string | number;
    message?: string;
    error?: string;
    redirect?: string;
  };
  await persistRotatedSession(admin, context);

  if (
    !response.ok ||
    json.success === false ||
    json.submission_id == null ||
    String(json.submission_id).trim() === ""
  ) {
    const message = String(
      json.error ?? json.message ?? `Upload failed with HTTP ${response.status}.`,
    );
    const code = /no slots|purchase more slots|slot/i.test(message)
      ? "UPSTREAM_NO_SLOTS"
      : "UPLOAD_REJECTED";
    throw new OriginalityAdapterError(code, message, response.status);
  }

  return {
    submissionId: String(json.submission_id),
    message: json.message ? String(json.message) : null,
  };
}

function mapSubmission(raw: Record<string, unknown>): OriginalitySubmission {
  return {
    id: String(raw.id ?? raw.submission_id ?? ""),
    status: String(raw.status ?? "pending").trim().toLowerCase(),
    aiPercentage: nullablePercent(raw.ai_percentage ?? raw.ai_detection),
    similarityPercentage: nullablePercent(
      raw.plag_percentage ?? raw.similarity_percentage,
    ),
    aiReportExists: boolish(raw.ai_report_exists),
    similarityReportExists: boolish(
      raw.plag_report_exists ?? raw.similarity_report_exists,
    ),
    aiUnavailableReason:
      raw.ai_unavailable_reason == null
        ? null
        : String(raw.ai_unavailable_reason),
    wordCount: nullableInteger(raw.word_count),
    submittedAt: raw.submitted_at == null ? null : String(raw.submitted_at),
    aiCompletedAt:
      raw.ai_completed_at == null ? null : String(raw.ai_completed_at),
    similarityCompletedAt:
      raw.similarity_completed_at == null
        ? null
        : String(raw.similarity_completed_at),
    refundReason:
      raw.refund_reason == null ? null : String(raw.refund_reason),
    viewerAvailable: boolish(raw.viewer_available),
    viewerUrl: raw.viewer_url == null ? null : String(raw.viewer_url),
  };
}

export async function getOriginalitySubmissionStatus(
  admin: AdminClient,
  submissionId: string,
): Promise<OriginalitySubmission | null> {
  const context = await loadSession(admin);
  const response = await sessionFetch(
    context,
    `/user/submissions-status?_=${Date.now()}`,
  );

  if (!response.ok) {
    throw new OriginalityAdapterError(
      "STATUS_FAILED",
      `Originality Reports status returned HTTP ${response.status}.`,
      response.status,
    );
  }

  const json = (await response.json()) as {
    success?: boolean;
    submissions?: Array<Record<string, unknown>>;
    error?: string;
  };
  await persistRotatedSession(admin, context);

  if (json.success === false) {
    throw new OriginalityAdapterError(
      "STATUS_FAILED",
      String(json.error ?? "Originality Reports status request failed."),
    );
  }

  const target = String(submissionId);
  for (const raw of json.submissions ?? []) {
    const mapped = mapSubmission(raw);
    if (mapped.id === target) return mapped;
  }
  return null;
}

async function fetchReportResponse(
  context: SessionContext,
  path: string,
): Promise<Response> {
  let currentUrl = upstreamUrl(path);

  for (let hop = 0; hop < 4; hop++) {
    const url = new URL(currentUrl);
    const isOriginality = url.hostname === "originality.report" ||
      url.hostname.endsWith(".originality.report");

    const headers = new Headers();
    headers.set("Accept", "application/pdf,application/octet-stream;q=0.9,*/*;q=0.8");
    if (isOriginality) {
      headers.set("Cookie", originalityCookieHeader(context.state));
      headers.set("Referer", ORIGINALITY_ORIGIN + "/dashboard");
    }

    const response = await fetch(currentUrl, {
      method: "GET",
      headers,
      redirect: "manual",
    });

    if (isOriginality) {
      mergeKnownSessionCookies(context, response);
      if (isLoginRedirect(response) || response.status === 401) {
        throw new OriginalityAdapterError(
          "SESSION_EXPIRED",
          "Originality Reports session has expired. Replace it in Admin.",
          response.status,
        );
      }
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) {
        throw new OriginalityAdapterError(
          "REPORT_REDIRECT_FAILED",
          "Originality Reports returned an empty report redirect.",
        );
      }
      const next = new URL(location, currentUrl);
      if (
        next.hostname.endsWith("originality.report") &&
        next.pathname.includes("/accounts/login")
      ) {
        throw new OriginalityAdapterError(
          "SESSION_EXPIRED",
          "Originality Reports session has expired. Replace it in Admin.",
        );
      }
      currentUrl = next.toString();
      continue;
    }

    return response;
  }

  throw new OriginalityAdapterError(
    "REPORT_REDIRECT_FAILED",
    "Originality Reports report download redirected too many times.",
  );
}

export async function downloadOriginalityReport(
  admin: AdminClient,
  submissionId: string,
  type: "similarity" | "ai",
): Promise<Uint8Array> {
  const context = await loadSession(admin);
  const response = await fetchReportResponse(
    context,
    `/user/download/${encodeURIComponent(submissionId)}/${type}`,
  );
  await persistRotatedSession(admin, context);

  if (!response.ok) {
    throw new OriginalityAdapterError(
      "REPORT_DOWNLOAD_FAILED",
      `Originality Reports ${type} report returned HTTP ${response.status}.`,
      response.status,
    );
  }

  const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
  if (!contentType.includes("application/pdf")) {
    throw new OriginalityAdapterError(
      "REPORT_DOWNLOAD_FAILED",
      `Originality Reports ${type} endpoint did not return a PDF.`,
    );
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_REPORT_BYTES) {
    throw new OriginalityAdapterError(
      "REPORT_DOWNLOAD_FAILED",
      `Originality Reports ${type} PDF has an invalid size.`,
    );
  }
  return bytes;
}
