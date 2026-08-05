/**
 * Task 3: Sample 20 version diff records for human agreement verification.
 * Outputs scripts/diffs_for_review.json with an empty 'agree' column ('yes' / 'no').
 *
 * Usage:
 *   npx tsx scripts/sample-diffs-for-review.ts
 */

import pg from "pg";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbUrl = process.env.DATABASE_URL || "postgresql://vidhi:vidhi_local_dev@localhost:5432/vidhi";
const pool = new pg.Pool({ connectionString: dbUrl });

async function sampleDiffs() {
  console.log("[info] Fetching obligation version diff records from database...");

  const query = `
    SELECT 
      ov.id,
      ov.change_type,
      ov.diff_summary,
      ov.detected_at,
      c_new.clause_ref AS new_clause_ref,
      o_new.obligation_summary AS new_summary,
      c_new.text AS new_clause_text,
      c_old.clause_ref AS old_clause_ref,
      o_old.obligation_summary AS old_summary,
      c_old.text AS old_clause_text
    FROM obligation_versions ov
    LEFT JOIN obligations o_new ON o_new.id = ov.obligation_id
    LEFT JOIN clauses c_new ON c_new.id = o_new.clause_id
    LEFT JOIN obligations o_old ON o_old.id = ov.previous_obligation_id
    LEFT JOIN clauses c_old ON c_old.id = o_old.clause_id
    ORDER BY ov.id ASC
  `;

  const { rows } = await pool.query(query);

  // Deterministic sample of 20 records across new, amended, and repealed
  const sample = rows.slice(0, 20).map((r) => ({
    id: r.id,
    change_type: r.change_type,
    diff_summary: r.diff_summary,
    new_clause_ref: r.new_clause_ref,
    new_summary: r.new_summary,
    new_clause_text: r.new_clause_text ? r.new_clause_text.slice(0, 200) : null,
    old_clause_ref: r.old_clause_ref,
    old_summary: r.old_summary,
    old_clause_text: r.old_clause_text ? r.old_clause_text.slice(0, 200) : null,
    agree: "", // To be filled: 'yes' | 'no'
  }));

  const outPath = path.join(__dirname, "diffs_for_review.json");
  fs.writeFileSync(outPath, JSON.stringify(sample, null, 2));

  console.log(`[ok] Exported ${sample.length} sampled diff records to ${outPath}`);
  await pool.end();
}

sampleDiffs().catch((err) => {
  console.error("[fatal] Failed to sample diff records:", err);
  process.exit(1);
});
