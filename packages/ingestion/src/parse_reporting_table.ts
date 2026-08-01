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
// ─────────────────────────────────────────────────────────────────────────────

const REPORTING_SECTION_RE = /reporting\s+requirements/i;

// End of reporting section: next major numbered section or "Annexure"
const SECTION_END_RE = /^(?:annexure|appendix|\d{1,3}\.\s{1,4}[A-Z])/;

// A row starts with a para number (matches 2+ level dotted refs that look like
// clause numbers, e.g. "20.1", "36.7", "4.2.1").
// We require at least one dot so we don't match bare section headers like "20. UCC".
const ROW_START_RE = /^(\d{1,3}(?:\.\d{1,3}){1,3})\s+(.*)/;

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
  const lines = rawText.split("\n").map((l) => l.trim()).filter(Boolean);

  // Find the Reporting Requirements section
  let sectionStart = -1;
  for (let i = 0; i < lines.length; i++) {
    if (REPORTING_SECTION_RE.test(lines[i])) {
      sectionStart = i;
      break;
    }
  }

  if (sectionStart === -1) {
    console.warn(
      "[warn] 'Reporting Requirements' section not found in PDF text. " +
        "Check that the heading appears verbatim in the extracted text."
    );
    return [];
  }

  console.log(`[info] Reporting Requirements section found at line ${sectionStart}.`);

  // Extract only the section content (stop at next major section or Annexure)
  const sectionLines: string[] = [];
  for (let i = sectionStart + 1; i < lines.length; i++) {
    if (SECTION_END_RE.test(lines[i]) && i > sectionStart + 5) {
      // Don't stop too early (skip the first few lines which may have sub-headers)
      break;
    }
    sectionLines.push(lines[i]);
  }

  // Parse rows: each row starts with a para number
  const rows: ReportingRow[] = [];
  let current: { paraNumber: string; parts: string[] } | null = null;

  for (const line of sectionLines) {
    const match = line.match(ROW_START_RE);

    if (match) {
      if (current) {
        rows.push(buildReportingRow(current.paraNumber, current.parts.join(" ")));
      }
      current = { paraNumber: match[1], parts: [match[2]] };
    } else if (current) {
      current.parts.push(line);
    }
  }

  if (current) {
    rows.push(buildReportingRow(current.paraNumber, current.parts.join(" ")));
  }

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
  for (const row of rows) {
    await pool.query(
      `INSERT INTO reporting_ground_truth
         (circular_id, para_number, description, to_whom, frequency, format_ref, parsed_from)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
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
    inserted++;
  }

  console.log(`[ok] Inserted ${inserted} ground truth rows for circular ${circularId}.`);
  console.log(`[ok] Run T2.2 (eval_against_ground_truth.ts) to compute extraction recall.`);

  await pool.end();
}

main().catch((err) => {
  console.error("[fatal]", err);
  process.exit(1);
});
