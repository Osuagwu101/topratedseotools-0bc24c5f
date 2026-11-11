/**
 * Client-side word counting for Turnitin uploads.
 *
 * Runs in the browser before upload so we can warn when a document is over
 * the 30,000-word AI-detection limit. Counts are an estimate of what
 * Turnitin/Originality will report:
 *  - DOCX: reads word/document.xml (+ footnotes/endnotes), joins text runs
 *    inside a paragraph without inserting spaces (Word splits single words
 *    across runs), skips deleted tracked changes and field codes.
 *  - PDF: extracts text page by page with pdf.js and re-inserts spaces where
 *    the PDF positions words apart without an explicit space character.
 *  - DOC (legacy binary): not supported; returns null.
 */

export const TURNITIN_AI_MAX_WORDS = 30_000;
export const TURNITIN_AI_MIN_WORDS = 300;

export type WordCountResult = {
  words: number;
  method: "docx" | "pdf";
};

/** A "word" is a whitespace-separated token containing a letter or digit. */
export function countWordsInText(text: string): number {
  let count = 0;
  for (const token of text.split(/[\s\u200b]+/)) {
    if (/[\p{L}\p{N}]/u.test(token)) count++;
  }
  return count;
}

/* ----------------------------- DOCX ----------------------------------- */

type ZipEntry = { name: string; method: number; compSize: number; offset: number };

function readZipEntries(buf: ArrayBuffer): ZipEntry[] {
  const view = new DataView(buf);
  // Find End Of Central Directory (signature 0x06054b50) scanning backwards.
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65_557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("Not a valid DOCX (zip) file.");
  const total = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  const out: ZipEntry[] = [];
  for (let n = 0; n < total; n++) {
    if (view.getUint32(p, true) !== 0x02014b50) break;
    const method = view.getUint16(p + 10, true);
    const compSize = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const localOffset = view.getUint32(p + 42, true);
    const name = dec.decode(new Uint8Array(buf, p + 46, nameLen));
    out.push({ name, method, compSize, offset: localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

async function readZipText(buf: ArrayBuffer, entry: ZipEntry): Promise<string> {
  const view = new DataView(buf);
  const nameLen = view.getUint16(entry.offset + 26, true);
  const extraLen = view.getUint16(entry.offset + 28, true);
  const start = entry.offset + 30 + nameLen + extraLen;
  const data = new Uint8Array(buf, start, entry.compSize);
  if (entry.method === 0) return new TextDecoder().decode(data);
  if (entry.method !== 8) throw new Error("Unsupported DOCX compression.");
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return await new Response(stream).text();
}

const XML_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
function decodeXml(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) => {
    if (e[0] === "#") {
      const cp = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : " ";
    }
    return XML_ENTITIES[e.toLowerCase()] ?? " ";
  });
}

/** Extract visible text from a WordprocessingML part. Exported for tests. */
export function docxXmlToText(xml: string): string {
  // Drop content that Word does not display as body text.
  const cleaned = xml
    .replace(/<w:del\b[\s\S]*?<\/w:del>/g, "") // deleted tracked changes
    .replace(/<w:instrText\b[^>]*>[\s\S]*?<\/w:instrText>/g, "") // field codes (TOC, HYPERLINK...)
    .replace(/<w:delInstrText\b[^>]*>[\s\S]*?<\/w:delInstrText>/g, "")
    .replace(/<mc:Fallback\b[\s\S]*?<\/mc:Fallback>/g, ""); // duplicate text-box content
  const parts: string[] = [];
  const re = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:(tab|br|cr)\b[^>]*\/>|<\/w:p>|<w:noBreakHyphen\/>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cleaned))) {
    if (m[1] !== undefined) parts.push(decodeXml(m[1]));
    else if (m[2]) parts.push(" ");
    else if (m[0] === "<w:noBreakHyphen/>") parts.push("-");
    else parts.push("\n"); // paragraph end
  }
  return parts.join("");
}

export async function countDocxWords(buf: ArrayBuffer): Promise<number> {
  const entries = readZipEntries(buf);
  const wanted = ["word/document.xml", "word/footnotes.xml", "word/endnotes.xml"];
  let text = "";
  for (const name of wanted) {
    const entry = entries.find((e) => e.name === name);
    if (!entry) continue;
    let xml = await readZipText(buf, entry);
    // Footnote/endnote parts contain separator placeholders with no text; fine.
    if (name !== "word/document.xml") xml = xml.replace(/<w:footnote w:type="(separator|continuationSeparator)"[\s\S]*?<\/w:footnote>/g, "");
    text += docxXmlToText(xml) + "\n";
  }
  if (!entries.some((e) => e.name === "word/document.xml")) {
    throw new Error("This DOCX file has no document body.");
  }
  return countWordsInText(text);
}

/* ------------------------------ PDF ----------------------------------- */

type PdfTextItem = { str: string; hasEOL?: boolean; transform: number[]; width: number; height: number };

/** Join pdf.js text items, inserting spaces where words are positioned apart. Exported for tests. */
export function joinPdfItems(items: PdfTextItem[]): string {
  let out = "";
  let prev: PdfTextItem | null = null;
  for (const it of items) {
    if (!("str" in it)) continue;
    if (prev) {
      const prevEndX = prev.transform[4] + prev.width;
      const x = it.transform[4];
      const sameLine = Math.abs(it.transform[5] - prev.transform[5]) < Math.max(1, (prev.height || 10) * 0.5);
      const fontSize = Math.max(1, Math.abs(prev.transform[0]) || prev.height || 10);
      if (!sameLine) out += " ";
      else if (x - prevEndX > fontSize * 0.15 && !/\s$/.test(out) && !/^\s/.test(it.str)) out += " ";
    }
    out += it.str;
    if (it.hasEOL) {
      // Hyphenated line break: "inter-\nnational" -> "international".
      if (/[\p{L}]-$/u.test(out)) out = out.slice(0, -1);
      else out += " ";
      prev = null;
      continue;
    }
    prev = it;
  }
  return out;
}

export async function countPdfWords(buf: ArrayBuffer): Promise<number> {
  const pdfjs = await import("pdfjs-dist");
  if (typeof window !== "undefined" && !pdfjs.GlobalWorkerOptions.workerSrc) {
    const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  }
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), isEvalSupported: false }).promise;
  try {
    let words = 0;
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      words += countWordsInText(joinPdfItems(content.items as PdfTextItem[]));
      page.cleanup();
    }
    return words;
  } finally {
    await doc.destroy();
  }
}

/* --------------------------- entry point ------------------------------ */

/** Returns null when the format cannot be counted in the browser (e.g. .doc). */
export async function countDocumentWords(file: File): Promise<WordCountResult | null> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".docx")) {
    return { words: await countDocxWords(await file.arrayBuffer()), method: "docx" };
  }
  if (name.endsWith(".pdf")) {
    return { words: await countPdfWords(await file.arrayBuffer()), method: "pdf" };
  }
  return null;
}
