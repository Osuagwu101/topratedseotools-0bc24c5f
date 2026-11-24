/** Private per-writer history and provider-limit handling for stateless QuillBot tools. */
const pct = n => Math.round(n <= 1 ? n * 100 : n);
const TOOLS = [
  {
    tool: 'AI Detector',
    test: /^\/api\/ai-detector\/score$/,
    entry(body, data) {
      const v = data?.data?.value;
      if (typeof body?.text !== 'string' || !body.text.trim() || !v || typeof v.aiScore !== 'number') return null;
      const parts = ['AI-generated: ' + pct(v.aiScore) + '%'];
      if (typeof v.aiParaphrasedScore === 'number') parts.push('AI-refined: ' + pct(v.aiParaphrasedScore) + '%');
      if (typeof v.humanParaphrasedScore === 'number') parts.push('Human-refined: ' + pct(v.humanParaphrasedScore) + '%');
      return { input: body.text, output: parts.join(' · ') };
    },
  },
  {
    tool: 'Summarizer',
    test: /^\/api\/summarizer\/summarize-para\/[a-z-]+$/,
    entry(body, data) {
      const summary = data?.data?.summary;
      if (typeof body?.para !== 'string' || !body.para.trim() || typeof summary !== 'string' || !summary.trim()) return null;
      return { input: body.para, output: summary };
    },
  },
];
export const toolForPath = path => TOOLS.find(t => t.test.test(path)) ?? null;
export function toolHistoryEntry(path, body, data) {
  const tool = toolForPath(path);
  if (!tool) return null;
  const entry = tool.entry(body, data);
  if (!entry || entry.input.length > 100000 || entry.output.length > 200000) return null;
  return { tool: tool.tool, ...entry };
}
/** Provider-owned tool APIs. Paraphraser calls are metered by the writer store instead. */
export const isProviderToolPath = path => /^\/api\/(?:ai-detector|summarizer|humanizer|plagiarism|grammar)(?:\/|$)/.test(path);
export function providerLimitHit(status, data) {
  if (status === 402 || status === 429) return true;
  const code = typeof data?.code === 'string' ? data.code : '';
  return /LIMIT|QUOTA|CREDIT|PREMIUM_REQUIRED|UPGRADE/i.test(code);
}
export const PROVIDER_LIMIT_BODY = {
  code: 'QB-02',
  message: 'This QuillBot tool is temporarily unavailable. Please contact Admin and mention reference QB-02. Your subscription remains active.',
};
