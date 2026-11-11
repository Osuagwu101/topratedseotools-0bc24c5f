/**
 * Unit tests for the pre-upload Turnitin word counter.
 * Run: npx tsx tests/turnitin-word-count.test.ts
 */
import {
  countWordsInText,
  docxXmlToText,
  joinPdfItems,
  MAX_WORDS_FOR_AI,
} from "../src/lib/turnitin-word-count";

let failures = 0;
function eq(name: string, got: unknown, expected: unknown) {
  const ok = got === expected;
  if (!ok) failures++;
  console.log(`${ok ? "  ✓" : "  ✗"} ${name}${ok ? "" : ` — got ${String(got)}, expected ${String(expected)}`}`);
}

const words = (xml: string) => countWordsInText(docxXmlToText(xml));
const item = (str: string, x: number, y = 700, width = str.length * 6, hasEOL = false) => ({
  str, transform: [12, 0, 0, 12, x, y], width, height: 12, hasEOL,
});

console.log("• text tokenising");
eq("plain words", countWordsInText("one two  three\nfour"), 4);
eq("punctuation-only tokens ignored", countWordsInText("Hello — world ; 2024 ."), 3);
eq("limit constant", MAX_WORDS_FOR_AI, 30_000);

console.log("• DOCX XML");
eq("runs inside a word are joined", words("<w:p><w:r><w:t>Intro</w:t></w:r><w:r><w:t>duction</w:t></w:r></w:p>"), 1);
eq("paragraphs separate words", words("<w:p><w:r><w:t>end</w:t></w:r></w:p><w:p><w:r><w:t>start</w:t></w:r></w:p>"), 2);
eq("tabs separate words", words('<w:p><w:r><w:t>a</w:t><w:tab/><w:t>b</w:t></w:r></w:p>'), 2);
eq("deleted tracked changes skipped",
  words("<w:p><w:del><w:r><w:delText>gone words</w:delText></w:r></w:del><w:r><w:t>kept</w:t></w:r></w:p>"), 1);
eq("field codes skipped",
  words('<w:p><w:r><w:instrText xml:space="preserve"> HYPERLINK "https://x.y/a b" </w:instrText></w:r><w:r><w:t>link text</w:t></w:r></w:p>'), 2);
eq("entities decoded", words("<w:p><w:r><w:t>R&amp;D costs</w:t></w:r></w:p>"), 2);

console.log("• PDF text items");
eq("gap between items inserts a space", countWordsInText(joinPdfItems([item("Hello", 0), item("world", 40)])), 2);
eq("adjacent glyph runs stay one word", countWordsInText(joinPdfItems([item("Hel", 0, 700, 18), item("lo", 18)])), 1);
eq("new line separates words", countWordsInText(joinPdfItems([item("end", 0, 700), item("start", 0, 686)])), 2);
eq("hyphen at end of line rejoined",
  countWordsInText(joinPdfItems([item("inter-", 0, 700, 36, true), item("national", 0, 686)])), 1);

if (failures) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log("\nall word-count tests passed");
