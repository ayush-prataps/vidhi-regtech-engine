/**
 * Ingestion: PDF -> clause-level chunks, scoped to target chapters.
 * Implements T1.1 (regex), T1.2 (pdf-parse), T1.4 (DB inserts).
 *
 * Scoped chapters (per build plan — do NOT ingest the full ~200-page doc):
 *   - "Unique Client Code"        (section ~20 in 2025, ~19 in 2024)
 *   - "Trading Account Opening"   (section adjacent to UCC)
 *   - "Reporting Requirements"    (final numbered chapter, table-heavy)
 *
 * Detection strategy: title-text matching, not hardcoded section numbers.
 * The two circulars number the same sections differently — title matching is
 * the only stable anchor across versions.
 *
 * Usage:
 *   # Register a new circular and chunk it in one step (recommended for first run):
 *   npm run chunk -- \
 *     --file data/raw/sebi/stockbrokers/17-06-2025-Master-Circular.pdf \
 *     --title "Master Circular for Stock Brokers 2025" \
 *     --circular-number "SEBI/HO/MIRSD/MIRSD-PoD/P/CIR/2025/90" \
 *     --date 2025-06-17 \
 *     --intermediary stockbroker
 *
 *   # Chunk only (circular already registered — add clauses to existing row):
 *   npm run chunk -- \
 *     --file data/raw/sebi/stockbrokers/09-08-2024-Master-Circular.pdf \
 *     --circular-id <uuid>
 *
 *   # Debug: dump clause chunks without writing to DB
 *   npm run chunk -- --file <path> --dry-run
 */

import { createRequire } from "node:module";
import pg from "pg";
import fs from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
// pdf-parse v1 is CJS and cannot be imported with ESM `import`
const pdfParse = require("pdf-parse") as (buf: Buffer) => Promise<{ text: string; numpages: number }>;

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

// ─────────────────────────────────────────────────────────────────────────────
// Clause header regex (T1.1)
//
// Matches three classes of clause boundaries:
//
//   1. Numbered clauses (up to 4-level dotted):
//        4.2 | 4.2.1 | 36.7.1.1 | 18.3(a) | 4.2.1.1(b)
//
//   2. Lettered sub-bullets at line start:
//        a) | b) | c) ... z)
//
//   3. Roman numeral sub-bullets:
//        i) | ii) | iii) | iv) | v) | vi) | vii) | viii) | ix) | x) | xi) | xii)
//
// The regex is anchored to the start of a trimmed line, so leading whitespace
// in the PDF text must be stripped before matching (done in chunkByClause).
// ─────────────────────────────────────────────────────────────────────────────

// Numbered clauses (up to 4-level dotted), with OPTIONAL trailing period.
// SEBI circulars use "20.1." style (trailing period) — the regex handles both:
//   "20.1." (with trailing period) and "20.1" (without).
const NUMBERED_PAT = "\\d{1,3}(?:\\.\\d{1,3}){0,3}\\.?(?:\\([a-z]{1,4}\\))?";

// Lettered: a) b) c) ... z)
const LETTERED_PAT = "[a-z]\\)";

// Roman numerals (practical range for SEBI sub-clauses: i through xii)
// Groups: single i/ii/iii | iv | v/vi/vii/viii | ix | x/xi/xii
const ROMAN_PAT = "(?:i{1,3}|iv|v|vi{1,3}|ix|xi{0,2})\\)";

export const CLAUSE_HEADER_RE = new RegExp(
  `^(${NUMBERED_PAT}|${LETTERED_PAT}|${ROMAN_PAT})\\s+(.+)`
);

// ─────────────────────────────────────────────────────────────────────────────
// Chapter anchor detection
//
// Title-text matching against exact patterns observed in pdf-parse output.
// SEBI section numbers shift between 2024 and 2025 editions — titles are stable.
//
// Verified against 17-06-2025-Master-Circular.pdf:
//   Line 3107:  "20.  Unique Client Code"
//   Line 3183:  "21. Simplification and Rationalization of Trading Account Opening Process"
//   Line 12064: "X. REPORTING REQUIREMENTS"
// ─────────────────────────────────────────────────────────────────────────────

const CHAPTER_ANCHORS: RegExp[] = [
  // Matches "20.  Unique Client Code" or "19.  Unique Client Code" (number shifts between versions)
  /^\d{1,3}\.\s{1,4}Unique\s+Client\s+Code/,
  // Matches "21. Simplification and Rationalization of Trading Account Opening Process" (or similar)
  /^\d{1,3}\.\s{1,4}Simplification\s+And\s+Rationalization/i,
  /^\d{1,3}\.\s{1,4}Trading\s+Account\s+Opening/i,
  // Matches "X. REPORTING REQUIREMENTS" (roman numeral chapter heading)
  /^[IVXLC]+\.\s+REPORTING\s+REQUIREMENTS/,

  // ── Phase 3 fixture chapters (2025 only — not in 2024 circular) ──────────
  // Fixture 2: "17. Framework for Monitoring and Supervision of System Audit of Stock Brokers"
  /^\d{1,3}\.\s{1,4}Framework\s+for\s+Monitoring\s+and\s+Supervision\s+of\s+System\s+Audit/i,
  // Fixture 3a: "71. Measure for Ease of Doing Business – Facilitation ... GIFT ..."
  //   Actual heading: "71. Measure for Ease of Doing Business – Facilitation to SEBI registered Stock"
  //   (continues on next line: "Brokers to undertake ... Gujarat International Finance Tech-city – IFSC")
  /^\d{1,3}\.\s{1,4}Measure\s+for\s+Ease\s+of\s+Doing\s+Business/i,
  // Fixture 3b: "72. Facilitation to SEBI registered Stock Brokers to access Negotiated Dealing"
  //   (continues: "System-Order Matching (NDS-OM) for trading in Government Securities")
  /^\d{1,3}\.\s{1,4}Facilitation\s+to\s+SEBI\s+registered\s+Stock\s+Brokers\s+to\s+access/i,
];


// Top-level section boundary: matches lines like "22. Nomination..." or "XI. ANNEXURES"
// Used to detect end of a scoped chapter window.
// Requires either a number or a roman numeral at the start.
const TOP_LEVEL_SECTION_RE = /^(?:\d{1,3}|[IVXLC]+)\.\s{1,4}\S/;

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface Clause {
  clauseRef: string;
  text: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Chapter window extraction
//
// TOC lines end with a bare page number (e.g. "20.  Unique Client Code 59").
// Body headings do NOT end with a bare integer. We skip TOC lines so the window
// covers only the actual body content, not the table of contents entries.
// ─────────────────────────────────────────────────────────────────────────────

// TOC lines end with a page number like " 59 " or " 231 "
const TOC_PAGE_NUM_RE = /\s+\d{1,4}\s*$/;

function isTocLine(line: string): boolean {
  return TOC_PAGE_NUM_RE.test(line);
}

function findChapterWindows(lines: string[]): Array<[number, number]> {
  const windows: Array<[number, number]> = [];
  let i = 0;

  while (i < lines.length) {
    const trimmed = lines[i].trim();
    const isAnchor = CHAPTER_ANCHORS.some((re) => re.test(trimmed));

    // Skip: not an anchor, or a TOC line (page-number suffix)
    if (!isAnchor || isTocLine(trimmed)) {
      i++;
      continue;
    }

    // Found a body anchor — advance until we hit a non-anchor top-level section
    const start = i;
    let end = i + 1;

    while (end < lines.length) {
      const next = lines[end].trim();

      // TOP_LEVEL_SECTION_RE fires on TOC lines too — apply the same TOC filter
      if (TOP_LEVEL_SECTION_RE.test(next) && !isTocLine(next)) {
        if (CHAPTER_ANCHORS.some((re) => re.test(next))) {
          end++;
          continue;
        }
        break;
      }
      end++;
    }

    windows.push([start, end]);
    i = end;
  }

  return windows;
}

// ─────────────────────────────────────────────────────────────────────────────
// Core chunker
// ─────────────────────────────────────────────────────────────────────────────

export function chunkByClause(rawText: string): Clause[] {
  const lines = rawText.split("\n");
  const windows = findChapterWindows(lines);

  if (windows.length === 0) {
    console.warn(
      "[warn] No scoped chapter windows found. " +
        "Anchors searched: Unique Client Code, Trading Account Opening, Reporting Requirements. " +
        "Check that these headings appear in the PDF text extraction output. " +
        "Falling back to full-document chunking for debugging — do NOT use this output for production."
    );
  }

  // If windows found, process only scoped lines; else full document (debug fallback)
  const scopedLines =
    windows.length > 0
      ? windows.flatMap(([start, end]) => lines.slice(start, end))
      : lines;

  const clauses: Clause[] = [];
  let current: Clause | null = null;

  for (const line of scopedLines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const match = trimmed.match(CLAUSE_HEADER_RE);
    if (match) {
      if (current) clauses.push(current);
      current = { clauseRef: match[1], text: match[2].trim() };
    } else if (current) {
      // Continuation line — append to current clause text
      current.text += " " + trimmed;
    }
    // Lines before the first clause match are silently skipped (chapter title, etc.)
  }

  if (current) clauses.push(current);
  return clauses;
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI helpers
// ─────────────────────────────────────────────────────────────────────────────

function getArg(flag: string): string | null {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 ? (process.argv[idx + 1] ?? null) : null;
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  const filePath = getArg("--file");
  const dryRun = hasFlag("--dry-run");

  if (!filePath) {
    console.error(
      "Usage:\n" +
        "  # Register + chunk:\n" +
        "  npm run chunk -- --file <path> --title <t> --circular-number <n> --date <YYYY-MM-DD> --intermediary <cat>\n\n" +
        "  # Chunk only (circular already registered):\n" +
        "  npm run chunk -- --file <path> --circular-id <uuid>\n\n" +
        "  # Debug (no DB writes):\n" +
        "  npm run chunk -- --file <path> --dry-run"
    );
    process.exit(1);
  }

  const absPath = path.resolve(filePath);
  if (!fs.existsSync(absPath)) {
    console.error(`File not found: ${absPath}`);
    process.exit(1);
  }

  // ── T1.2: Real PDF text extraction (pdf-parse) ───────────────────────────
  console.log(`[info] Extracting PDF text from: ${absPath}`);
  const buffer = fs.readFileSync(absPath);
  const parsed = await pdfParse(buffer);
  // Sanitize: strip null bytes (0x00) that some PDFs embed and Postgres rejects
  const rawText = parsed.text.replace(/\0/g, "");

  console.log(
    `[info] Extracted ${rawText.length.toLocaleString()} chars across ${parsed.numpages} pages.`
  );

  // ── Resolve circular_id ──────────────────────────────────────────────────
  let circularId = getArg("--circular-id");

  if (!dryRun && !circularId) {
    // Register mode: INSERT INTO circulars and get back the UUID
    const title = getArg("--title");
    const circularNumber = getArg("--circular-number");
    const date = getArg("--date");
    const intermediary = getArg("--intermediary");

    if (!title || !circularNumber || !date || !intermediary) {
      console.error(
        "When --circular-id is not provided, supply all of:\n" +
          "  --title, --circular-number, --date (YYYY-MM-DD), --intermediary"
      );
      process.exit(1);
    }

    const { rows } = await pool.query(
      `INSERT INTO circulars
         (title, circular_number, issued_date, intermediary_category, raw_text)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [title, circularNumber, date, intermediary, rawText]
    );
    circularId = rows[0].id as string;
    console.log(`[info] Registered circular: ${circularId}`);
  }

  // ── Chunk ────────────────────────────────────────────────────────────────
  console.log("[info] Chunking by clause (scoped chapters only)...");
  const clauses = chunkByClause(rawText);
  console.log(`[info] Produced ${clauses.length} clause chunks.`);

  if (clauses.length === 0) {
    console.error(
      "[error] Zero chunks produced. Inspect PDF text output manually:\n" +
        "  node -e \"const p=require('pdf-parse'); p(require('fs').readFileSync('" +
        absPath +
        "')).then(r=>console.log(r.text.slice(0,3000)))\""
    );
    process.exit(1);
  }

  if (dryRun) {
    // Print first 20 chunks for visual inspection
    console.log("\n[dry-run] First 20 chunks:");
    clauses.slice(0, 20).forEach((c, i) => {
      console.log(`  [${i + 1}] ref="${c.clauseRef}" text="${c.text.slice(0, 100)}..."`);
    });
    console.log("\n[dry-run] No DB writes performed.");
    return;
  }

  // ── T1.4: DB inserts ─────────────────────────────────────────────────────
  // Delete stale clauses for this circular before re-inserting (idempotent re-runs)
  await pool.query("DELETE FROM clauses WHERE circular_id = $1", [circularId]);
  console.log(`[info] Cleared existing clauses for circular ${circularId}.`);

  console.log("[info] Inserting clauses...");
  let inserted = 0;
  for (const clause of clauses) {
    await pool.query(
      `INSERT INTO clauses (circular_id, clause_ref, text) VALUES ($1, $2, $3)`,
      [circularId, clause.clauseRef, clause.text]
    );
    inserted++;
  }

  console.log(`[ok] Inserted ${inserted} clauses for circular ${circularId}.`);
  await pool.end();
}

main().catch((err) => {
  console.error("[fatal]", err);
  process.exit(1);
});
