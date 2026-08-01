/**
 * T1.6: Parse the "Reporting Requirements" chapter table from both master circulars.
 *
 * This produces the `reporting_ground_truth` table — SEBI's own curated list of
 * reporting obligations. It is ground truth (authored by SEBI itself), NOT model output.
 * Used in Phase 2 (T2.2) to compute extraction recall: what fraction of these
 * official reporting obligations did the LLM extraction independently find?
 *
 * Table structure in the PDF (column names vary slightly between versions):
 *   Para No. | Reporting Requirement / Subject | To Whom | Frequency | Format/Annexure
 *
 * Parsing strategy:
 *   - Locate the "Reporting Requirements" section by heading match
 *   - Detect table rows: lines starting with a paragraph number (e.g. "20.1", "36.7")
 *   - Accumulate multi-line cells (pdf-parse wraps long descriptions)
 *   - Extract "To Whom" and "Frequency" from the combined row text via pattern matching
 *
 * Usage:
 *   npm run parse-reporting -- \
 *     --file data/raw/sebi/stockbrokers/17-06-2025-Master-Circular.pdf \
 *     --circular-id <uuid> \
 *     --version 2025-06-17
 */

import { createRequire } from "node:module";
import pg from "pg";
import fs from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse") as (buf: Buffer) => Promise<{ text: string; numpages: number }>;

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

// ─────────────────────────────────────────────────────────────────────────────
// Section detection
//
// Verified against 17-06-2025-Master-Circular.pdf:
//   TOC entry:  line 353 -- "X.    REPORTING REQUIREMENTS 231 " (ends with page number)
//   Body entry: line 12064 -- "X. REPORTING REQUIREMENTS " (no trailing page number)
//
// Table row format (from PDF extraction):
//   "1.  13.2 " on one line, then description on subsequent lines.
//   Pattern: row starts with a bare serial number followed by a para ref.
// ─────────────────────────────────────────────────────────────────────────────

// Body section heading — all caps, roman numeral, NO trailing page number
const REPORTING_BODY_RE = /^[IVXLC]+\.\s+REPORTING\s+REQUIREMENTS\s*$/;

// TOC lines end with a page number — skip these (same heuristic as chunk.ts)
const TOC_PAGE_NUM_RE = /\s+\d{1,4}\s*$/;

// Matches the combined S.No + Para No. row: e.g. "1.  13.2 " or "23.  16-Table–8"
// Group 1 = serial number (1, 2, 3...), Group 2 = para reference
const TABLE_ROW_RE = /^(\d{1,3})\.\s{1,4}(\S.*)/;

// End of table: hits another roman numeral section or "Annexure"
const TABLE_END_RE = /^(?:annexure|appendix|[IVXLC]+\.\s)/i;

// Known "To Whom" values in SEBI reporting tables
const TO_WHOM_RE =
  /(?:stock\s+exchange|sebi|depositories?|clearing\s+corporation|nse|bse|cdsl|nsdl)/i;

// Frequency values
const FREQUENCY_RE =
  /(?:monthly|quarterly|annual(?:ly)?|half.?year(?:ly)?|daily|weekly|on.?event|one.?time|within\s+\d+\s+days?)/i;

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface ReportingRow {
  paraNumber: string;
  description: string;
  toWhom: string | null;
  frequency: string | null;
  formatRef: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Parser
// ─────────────────────────────────────────────────────────────────────────────

export function parseReportingTable(rawText: string): ReportingRow[] {
  const lines = rawText.split("\n");

  // Find the BODY section (not the TOC entry)
  // TOC entry: ends with a page number like " 231 "
  // Body entry: "X. REPORTING REQUIREMENTS " — no trailing page number
  let sectionStart = -1;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (REPORTING_BODY_RE.test(t) && !TOC_PAGE_NUM_RE.test(t)) {
      sectionStart = i;
      break;
    }
  }

  if (sectionStart === -1) {
    console.warn(
      "[warn] Body 'REPORTING REQUIREMENTS' section not found. " +
        "Looked for all-caps roman-numeral heading without trailing page number."
    );
    return [];
  }

  console.log(`[info] Reporting Requirements body found at line ${sectionStart}.`);

  // Parse the table rows that follow.
  // Row format: "1.  13.2 " (S.No. + Para ref on one line), then description on subsequent lines.
  // We use S.No. as the row boundary and capture the Para ref (group 2 of TABLE_ROW_RE).
  const rows: ReportingRow[] = [];
  let current: { srNo: number; paraNumber: string; parts: string[] } | null = null;

  for (let i = sectionStart + 1; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t) continue;

    // Stop at next major section
    if (TABLE_END_RE.test(t) && i > sectionStart + 10) break;

    const rowMatch = t.match(TABLE_ROW_RE);
    if (rowMatch) {
      const srNo = parseInt(rowMatch[1], 10);
      // Sanity check: S.No should be sequential (allow small gaps for sub-headers)
      const lastSr: number = current?.srNo ?? 0;

      if (srNo > 0 && (lastSr === 0 || srNo === lastSr + 1 || srNo <= lastSr + 3)) {
        if (current) {
          rows.push(buildReportingRow(current.paraNumber, current.parts.join(" ")));
        }
        // rowMatch[2] is "13.2 " or "16-Table–8 (1.5) ..."
        // Extract the para number as the first token
        const rest = rowMatch[2].trim();
        const spaceIdx = rest.search(/\s/);
        const paraNumber = spaceIdx === -1 ? rest : rest.slice(0, spaceIdx);
        const descStart = spaceIdx === -1 ? "" : rest.slice(spaceIdx + 1).trim();
        current = { srNo, paraNumber, parts: descStart ? [descStart] : [] };
        continue;
      }
    }

    // Continuation line
    if (current) current.parts.push(t);
  }

  if (current) rows.push(buildReportingRow(current.paraNumber, current.parts.join(" ")));

  return rows;
}

function buildReportingRow(paraNumber: string, combinedText: string): ReportingRow {
  const toWhomMatch  = combinedText.match(TO_WHOM_RE);
  const freqMatch    = combinedText.match(FREQUENCY_RE);

  // Format/Annexure reference
  const formatMatch  = combinedText.match(/annexure\s+[-–A-Z0-9]+/i);

  // Description: full combined text (evaluators need the original wording for recall check)
  const description  = combinedText.replace(/\s+/g, " ").trim();

  return {
    paraNumber,
    description,
    toWhom:    toWhomMatch  ? toWhomMatch[0]  : null,
    frequency: freqMatch    ? freqMatch[0]    : null,
    formatRef: formatMatch  ? formatMatch[0]  : null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI helpers
// ─────────────────────────────────────────────────────────────────────────────

function getArg(flag: string): string | null {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 ? (process.argv[idx + 1] ?? null) : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  const filePath   = getArg("--file");
  const circularId = getArg("--circular-id");
  const version    = getArg("--version");

  if (!filePath || !circularId || !version) {
    console.error(
      "Usage:\n" +
        "  npm run parse-reporting -- --file <path> --circular-id <uuid> --version <YYYY-MM-DD>"
    );
    process.exit(1);
  }

  const absPath = path.resolve(filePath);
  if (!fs.existsSync(absPath)) {
    console.error(`File not found: ${absPath}`);
    process.exit(1);
  }

  console.log(`[info] Extracting text from ${absPath}...`);
  const buffer = fs.readFileSync(absPath);
  const parsed = await pdfParse(buffer);

  console.log("[info] Parsing Reporting Requirements table...");
  const rows = parseReportingTable(parsed.text);
  console.log(`[info] Parsed ${rows.length} reporting obligation rows.`);

  if (rows.length === 0) {
    console.warn(
      "[warn] Zero rows parsed. This may be because:\n" +
        "  - The section heading doesn't match exactly (check PDF text output)\n" +
        "  - The table uses a different para numbering format\n" +
        "  - pdf-parse lost table structure (try inspecting the raw text)\n" +
        "\nDebug: node -e \"require('pdf-parse')(require('fs').readFileSync('" +
        absPath +
        "')).then(r=>process.stdout.write(r.text))\""
    );
    process.exit(1);
  }

  // Idempotent: clear existing rows for this circular
  await pool.query(
    "DELETE FROM reporting_ground_truth WHERE circular_id = $1",
    [circularId]
  );

  let inserted = 0;
  for (let idx = 0; idx < rows.length; idx++) {
    const row = rows[idx];
    // Use ON CONFLICT DO NOTHING: the same para_number may appear multiple times in the
    // SEBI table (same obligation listed under different reporting categories).
    // We keep the first occurrence per (circular_id, para_number).
    const result = await pool.query(
      `INSERT INTO reporting_ground_truth
         (circular_id, para_number, description, to_whom, frequency, format_ref, parsed_from)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (circular_id, para_number) DO NOTHING`,
      [
        circularId,
        row.paraNumber,
        row.description,
        row.toWhom,
        row.frequency,
        row.formatRef,
        version,
      ]
    );
    inserted += result.rowCount ?? 0;
  }


  console.log(`[ok] Inserted ${inserted} ground truth rows for circular ${circularId}.`);
  console.log(`[ok] Run T2.2 (eval_against_ground_truth.ts) to compute extraction recall.`);

  await pool.end();
}

main().catch((err) => {
  console.error("[fatal]", err);
  process.exit(1);
});
