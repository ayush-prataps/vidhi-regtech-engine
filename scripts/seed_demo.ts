/**
 * T5.1: High-performance deterministic demo seed script.
 * Resets any target database (Local or Neon Cloud) to a clean, 100% demo-ready
 * state in under 2 seconds using batch multi-row INSERTs.
 *
 * Usage:
 *   npm run seed
 *   DATABASE_URL="postgres://..." npm run seed
 */

import pg from "pg";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbUrl: string = process.env.DATABASE_URL || "";

if (!dbUrl) {
  console.error("[fatal] DATABASE_URL environment variable is required.");
  process.exit(1);
}

// Suppress SSL mode alias warnings when connecting to Neon / Cloud Postgres
const pool = new pg.Pool({
  connectionString: dbUrl,
  ssl: dbUrl.includes("sslmode=require") || dbUrl.includes("neon.tech")
    ? { rejectUnauthorized: false }
    : undefined,
});

/** Helper to safely parse dates into valid YYYY-MM-DD or null */
function parseValidDate(dateVal: any): string | null {
  if (!dateVal || typeof dateVal !== "string") return null;
  const trimmed = dateVal.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const parsed = Date.parse(trimmed);
  if (isNaN(parsed)) return null;
  try {
    return new Date(parsed).toISOString().split("T")[0];
  } catch {
    return null;
  }
}

/** Helper to do fast batch inserts of an array of objects */
async function batchInsert(
  tableName: string,
  columns: string[],
  rows: any[],
  onConflict: string = "",
  dateColumns: string[] = []
) {
  if (!rows || rows.length === 0) return;
  const batchSize = 100;
  for (let i = 0; i < rows.length; i += batchSize) {
    const chunk = rows.slice(i, i + batchSize);
    const valuePlaceholders: string[] = [];
    const values: any[] = [];
    let pIdx = 1;

    for (const row of chunk) {
      const tuple: string[] = [];
      for (const col of columns) {
        tuple.push(`$${pIdx++}`);
        let val = row[col];
        if (dateColumns.includes(col)) {
          val = parseValidDate(val);
        }
        values.push(val);
      }
      valuePlaceholders.push(`(${tuple.join(", ")})`);
    }

    const sql = `
      INSERT INTO ${tableName} (${columns.join(", ")})
      VALUES ${valuePlaceholders.join(", ")}
      ${onConflict}
    `;
    await pool.query(sql, values);
  }
}

async function seed() {
  const startTime = Date.now();
  console.log(`[info] Connecting to database: ${dbUrl.replace(/:[^:@]+@/, ":****@")}`);

  // 1. DDL setup: ensure extensions and tables exist
  console.log("[info] Initializing DDL schema & tables...");
  await pool.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto;`);
  
  try {
    await pool.query(`CREATE EXTENSION IF NOT EXISTS vector;`);
  } catch (err) {
    console.warn("[warn] Extension 'vector' could not be enabled, continuing...");
  }

  // Schema DDL
  const schemaSql = fs.readFileSync(path.join(__dirname, "../db/schema.sql"), "utf-8");
  const migrationSql = fs.readFileSync(
    path.join(__dirname, "../db/migrations/002_reporting_ground_truth.sql"),
    "utf-8"
  );

  const cleanSchema = schemaSql
    .replace(/CREATE EXTENSION IF NOT EXISTS vector;/gi, "")
    .replace(/CREATE EXTENSION IF NOT EXISTS pgcrypto;/gi, "");

  await pool.query(cleanSchema);
  await pool.query(migrationSql);

  // Alter appendix_circulars.issued_date to TEXT if needed to avoid strict date parsing errors
  try {
    await pool.query(`ALTER TABLE appendix_circulars ALTER COLUMN issued_date TYPE TEXT;`);
  } catch {
    // Column already TEXT or not created yet
  }

  // 2. Truncate existing data cleanly
  console.log("[info] Cleaning existing database records...");
  await pool.query(`
    TRUNCATE TABLE obligation_versions, evidence, obligations, clauses, reporting_ground_truth, appendix_circulars, circulars, organizations CASCADE;
  `);

  // 3. Load seed dataset
  const seedPath = path.join(__dirname, "seed_data.json");
  if (!fs.existsSync(seedPath)) {
    console.error(`[fatal] Seed data file not found at: ${seedPath}`);
    process.exit(1);
  }

  const data = JSON.parse(fs.readFileSync(seedPath, "utf-8"));

  // Batch insert tables
  console.log("[info] Seeding circulars...");
  await batchInsert(
    "circulars",
    ["id", "title", "circular_number", "issued_date", "source_url", "intermediary_category", "version", "raw_text", "ingested_at"],
    data.circulars,
    "",
    ["issued_date"]
  );

  console.log(`[info] Seeding ${data.clauses.length} clauses...`);
  await batchInsert(
    "clauses",
    ["id", "circular_id", "clause_ref", "text"],
    data.clauses,
    "ON CONFLICT (circular_id, clause_ref) DO NOTHING"
  );

  console.log(`[info] Seeding ${data.obligations.length} obligations...`);
  await batchInsert(
    "obligations",
    [
      "id",
      "circular_id",
      "clause_id",
      "intermediary_category",
      "obligation_summary",
      "action_required",
      "frequency",
      "deadline_rule",
      "evidence_type",
      "status",
      "extracted_by_model",
      "extraction_confidence",
      "created_at",
    ],
    data.obligations
  );

  console.log(`[info] Seeding ${data.obligation_versions.length} version diff records...`);
  await batchInsert(
    "obligation_versions",
    ["id", "obligation_id", "previous_obligation_id", "change_type", "diff_summary", "detected_at"],
    data.obligation_versions
  );

  console.log(`[info] Seeding ${data.appendix_circulars.length} appendix circulars...`);
  await batchInsert(
    "appendix_circulars",
    ["id", "circular_id", "sr_no", "ref_circular_number", "subject", "issued_date", "rescinded", "parsed_from", "created_at"],
    data.appendix_circulars,
    "ON CONFLICT (circular_id, sr_no) DO NOTHING"
  );

  console.log(`[info] Seeding ${data.reporting_ground_truth.length} reporting ground truth rows...`);
  await batchInsert(
    "reporting_ground_truth",
    ["id", "circular_id", "para_number", "description", "to_whom", "frequency", "format_ref", "parsed_from", "created_at"],
    data.reporting_ground_truth,
    "ON CONFLICT (circular_id, para_number) DO NOTHING"
  );

  // Pre-configure demo organization & evidence items
  console.log("[info] Pre-configuring demo organization & evidence items...");
  const demoOrgId = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";
  await pool.query(
    `INSERT INTO organizations (id, name, intermediary_category)
     VALUES ($1, 'Acme Broking Pvt Ltd', 'stockbroker')
     ON CONFLICT (id) DO NOTHING`,
    [demoOrgId]
  );

  const activeObsRes = await pool.query(
    `SELECT id FROM obligations WHERE status = 'active' ORDER BY clause_id LIMIT 3`
  );
  
  if (activeObsRes.rows.length >= 3) {
    const ob1 = activeObsRes.rows[0].id;
    const ob2 = activeObsRes.rows[1].id;
    const ob3 = activeObsRes.rows[2].id;

    await pool.query(
      `INSERT INTO evidence (obligation_id, org_id, description, file_url, review_status)
       VALUES 
       ($1, $4, 'Monthly UCC Particulars Log July 2025 submitted to NSE/BSE', 's3://compliance-docs/2025/07/ucc_monthly_return.pdf', 'accepted'),
       ($2, $4, 'Quarterly Demat Settlement & Verification Statement Q2 2025', 's3://compliance-docs/2025/q2/demat_settlement_statement.pdf', 'accepted'),
       ($3, $4, 'System Audit Financial Disincentive Policy & Schedule 2025', 's3://compliance-docs/2025/sysaudit_policy.pdf', 'accepted')`,
      [ob1, ob2, ob3, demoOrgId]
    );
  }

  // Pre-flag 2 obligations as 'needs_review'
  await pool.query(`
    UPDATE obligations 
    SET status = 'needs_review' 
    WHERE id IN (
      SELECT id FROM obligations 
      WHERE obligation_summary ILIKE '%voluntary%' OR obligation_summary ILIKE '%disincentive%'
      LIMIT 2
    );
  `);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`\n[ok] Database seeded successfully in ${elapsed}s! Demo state ready.`);
  await pool.end();
}

seed().catch((err) => {
  console.error("[fatal] Seeding failed:", err);
  process.exit(1);
});
