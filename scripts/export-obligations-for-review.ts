/**
 * Task 1: Export all 114 extracted obligations for human review.
 * Outputs scripts/obligations_for_review.json with an empty 'label' column
 * to be filled with 'TP' (True Positive), 'FP' (False Positive), or 'uncertain'.
 *
 * Usage:
 *   npx tsx scripts/export-obligations-for-review.ts
 */

import pg from "pg";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbUrl = process.env.DATABASE_URL || "postgresql://vidhi:vidhi_local_dev@localhost:5432/vidhi";
const pool = new pg.Pool({ connectionString: dbUrl });

async function exportObligations() {
  console.log("[info] Fetching all extracted obligations from database...");

  const query = `
    SELECT 
      o.id,
      c.clause_ref,
      o.obligation_summary,
      o.action_required,
      o.intermediary_category,
      o.frequency,
      o.deadline_rule,
      o.evidence_type,
      o.status,
      o.extraction_confidence,
      c.text AS clause_text
    FROM obligations o
    JOIN clauses c ON c.id = o.clause_id
    ORDER BY c.clause_ref ASC, o.id ASC
  `;

  const { rows } = await pool.query(query);

  const exportData = rows.map((r) => ({
    id: r.id,
    clause_ref: r.clause_ref,
    obligation_summary: r.obligation_summary,
    action_required: r.action_required,
    intermediary_category: r.intermediary_category,
    frequency: r.frequency,
    deadline_rule: r.deadline_rule,
    evidence_type: r.evidence_type,
    status: r.status,
    confidence: r.extraction_confidence,
    clause_text: r.clause_text,
    label: "", // To be filled: 'TP' | 'FP' | 'uncertain'
  }));

  const outPath = path.join(__dirname, "obligations_for_review.json");
  fs.writeFileSync(outPath, JSON.stringify(exportData, null, 2));

  console.log(`[ok] Exported ${exportData.length} obligations to ${outPath}`);
  await pool.end();
}

exportObligations().catch((err) => {
  console.error("[fatal] Failed to export obligations:", err);
  process.exit(1);
});
