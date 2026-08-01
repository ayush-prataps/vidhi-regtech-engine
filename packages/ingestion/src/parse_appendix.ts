/**
 * T1.5: Parse the "Appendix — List of Circulars/Communications" table from both PDFs.
 *
 * The appendix lists all superseded/consolidated circulars. It is the ground truth for:
 *   - Phase 3 diff validation: Sr. nos. 119-130 of the June 2025 appendix are confirmed
 *     rescinded per the circular's own preamble ("to the extent they relate to stock brokers").
 *   - Cross-reference resolution: inline "in continuation of Circular X" references.
 *
 * Strategy:
 *   The appendix table in the PDF has structure:
 *     Sr. No. | Circular Reference | Subject | Date
 *   pdf-parse loses column boundaries. We detect rows by: line starts with a bare integer
 *   followed by text that looks like a circular reference (SEBI/...) or a subject description.
 *
 * Usage:
 *   npm run parse-appendix -- \
 *     --file data/raw/sebi/stockbrokers/17-06-2025-Master-Circular.pdf \
 *     --circular-id <uuid> \
 *     --version 2025-06-17
 *
 *   npm run parse-appendix -- \
 *     --file data/raw/sebi/stockbrokers/09-08-2024-Master-Circular.pdf \
 *     --circular-id <uuid> \
 *     --version 2024-08-09
 */

import { createRequire } from "node:module";
import pg from "pg";
import fs from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse") as (buf: Buffer) => Promise<{ text: string; numpages: number }>;

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

// ─────────────────────────────────────────────────────────────────────────────
// Appendix section detection
// ─────────────────────────────────────────────────────────────────────────────

const APPENDIX_START_RE = /appendix\s*[-–—]?\s*list\s+of\s+circulars/i;
const APPENDIX_ALT_RE   = /list\s+of\s+circulars\s*(?:\/\s*communications)?/i;

// A row in the appendix table starts with a bare integer (the Sr. No.)
// Accepts: "1 ", "119 ", optionally preceded by some whitespace.
const APPENDIX_ROW_RE = /^(\d{1,3})\s+(.+)/;

// SEBI circular reference pattern: SEBI/HO/... or SEBI/MIRSD/... etc.
const CIRCULAR_REF_RE = /SEBI\/[A-Z/]+\/\d{4}\/\d+/;

// Date patterns in appendix: DD/MM/YYYY or DD-MM-YYYY or Month DD, YYYY
const DATE_RE = /(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\w+ \d{1,2},?\s*\d{4})/;

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface AppendixRow {
  srNo: number;
  refCircularNumber: string;
  subject: string;
  issuedDate: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Parser
// ─────────────────────────────────────────────────────────────────────────────

export function parseAppendix(rawText: string): AppendixRow[] {
  const lines = rawText.split("\n").map((l) => l.trim()).filter(Boolean);

  // Find where the appendix starts
  let appendixStart = -1;
  for (let i = 0; i < lines.length; i++) {
    if (APPENDIX_START_RE.test(lines[i]) || APPENDIX_ALT_RE.test(lines[i])) {
      appendixStart = i;
      break;
    }
  }

  if (appendixStart === -1) {
    console.warn(
      "[warn] Could not locate appendix section in PDF text. " +
        "Looked for: 'Appendix - List of Circulars' or 'List of Circulars/Communications'."
    );
    return [];
  }

  console.log(`[info] Appendix section found at line ${appendixStart}.`);

  // Collect lines from the appendix onward
  const appendixLines = lines.slice(appendixStart + 1);

  // Parse rows: each row begins with an integer Sr. No.
  // A row may span multiple lines if the subject/reference wraps.
  const rows: AppendixRow[] = [];
  let currentRow: { srNo: number; parts: string[] } | null = null;

  for (const line of appendixLines) {
    const match = line.match(APPENDIX_ROW_RE);

    if (match) {
      const srNo = parseInt(match[1], 10);

      // Sanity check: sr_no should be sequential (within ±5 of last seen)
      const lastSr = rows.length > 0 ? rows[rows.length - 1].srNo : 0;
      const isLikelyNewRow = srNo > 0 && (rows.length === 0 || srNo === lastSr + 1 || srNo <= lastSr + 5);

      if (isLikelyNewRow) {
        // Flush the previous row
        if (currentRow) {
          rows.push(buildRow(currentRow.srNo, currentRow.parts.join(" ")));
        }
        currentRow = { srNo, parts: [match[2]] };
        continue;
      }
    }

    // Continuation line
    if (currentRow) {
      currentRow.parts.push(line);
    }
  }

  // Flush last row
  if (currentRow) {
    rows.push(buildRow(currentRow.srNo, currentRow.parts.join(" ")));
  }

  return rows;
}

function buildRow(srNo: number, combinedText: string): AppendixRow {
  // Try to extract a circular reference (SEBI/HO/...)
  const refMatch = combinedText.match(CIRCULAR_REF_RE);
  const refCircularNumber = refMatch ? refMatch[0] : combinedText.slice(0, 80);

  // Try to extract a date
  const dateMatch = combinedText.match(DATE_RE);
  const issuedDate = dateMatch ? dateMatch[0] : null;

  // Subject: what remains after removing the circular ref and date
  const subject = combinedText
    .replace(CIRCULAR_REF_RE, "")
    .replace(DATE_RE, "")
    .replace(/\s+/g, " ")
    .trim();

  return { srNo, refCircularNumber, subject, issuedDate };
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
  const filePath    = getArg("--file");
  const circularId  = getArg("--circular-id");
  const version     = getArg("--version"); // e.g. '2025-06-17' or '2024-08-09'

  if (!filePath || !circularId || !version) {
    console.error(
      "Usage:\n" +
        "  npm run parse-appendix -- --file <path> --circular-id <uuid> --version <YYYY-MM-DD>"
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

  console.log("[info] Parsing appendix table...");
  const rows = parseAppendix(parsed.text);
  console.log(`[info] Parsed ${rows.length} appendix rows.`);

  if (rows.length === 0) {
    console.error("[error] Zero appendix rows parsed. Inspect PDF text manually.");
    process.exit(1);
  }

  // Mark rescinded rows (June 2025 version: Sr. nos. 119-130 are confirmed rescinded)
  // per the confirmed fixture in the build plan.
  const isRescindedVersion = version === "2025-06-17";

  // Clear existing rows for this circular before re-inserting (idempotent)
  await pool.query("DELETE FROM appendix_circulars WHERE circular_id = $1", [circularId]);

  let inserted = 0;
  for (const row of rows) {
    const rescinded = isRescindedVersion && row.srNo >= 119 && row.srNo <= 130;
    await pool.query(
      `INSERT INTO appendix_circulars
         (circular_id, sr_no, ref_circular_number, subject, issued_date, rescinded, parsed_from)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        circularId,
        row.srNo,
        row.refCircularNumber,
        row.subject,
        row.issuedDate,
        rescinded,
        version,
      ]
    );
    inserted++;

    if (rescinded) {
      console.log(`  [rescinded] Sr. ${row.srNo}: ${row.refCircularNumber}`);
    }
  }

  console.log(`[ok] Inserted ${inserted} appendix rows for circular ${circularId}.`);
  console.log(
    `[ok] Rescinded rows (119-130 in 2025 version): ${rows.filter((r) => r.srNo >= 119 && r.srNo <= 130 && isRescindedVersion).length}`
  );

  await pool.end();
}

main().catch((err) => {
  console.error("[fatal]", err);
  process.exit(1);
});
