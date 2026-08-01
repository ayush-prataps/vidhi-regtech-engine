/**
 * Extraction: clause text -> grounded obligation records via Groq/Llama 3.3 70B.
 * Implements T2.1 (real extraction run) with:
 *   - Rate limiting: 2s sleep between Groq calls (free tier ~30 req/min for 70B)
 *   - Retry with exponential backoff: up to 3 attempts per clause on JSON/schema failures
 *   - JSON repair pass: re-asks model to fix malformed output before throwing
 *   - Idempotent re-runs: DELETE existing obligations for circular before re-inserting
 *   - --dry-run mode: prints obligations without writing to DB
 *   - --limit N: process only the first N clauses (useful for spot-checking)
 *
 * Usage:
 *   npm run extract -- --circular-id <uuid>
 *   npm run extract -- --circular-id <uuid> --dry-run
 *   npm run extract -- --circular-id <uuid> --limit 5
 */

import Groq from "groq-sdk";
import pg from "pg";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ExtractionResultSchema } from "./schemas/obligation.js";


const __dirname = path.dirname(fileURLToPath(import.meta.url));

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

// ─────────────────────────────────────────────────────────────────────────────
// Load and parse the system prompt.
// The markdown file has a metadata header — strip everything up to and including
// "## SYSTEM PROMPT START", and stop before "## SYSTEM PROMPT END".
// ─────────────────────────────────────────────────────────────────────────────

const RAW_PROMPT_FILE = fs.readFileSync(
  path.join(__dirname, "prompts", "obligation_extraction.md"),
  "utf-8"
);

function parseSystemPrompt(raw: string): string {
  const startMarker = "## SYSTEM PROMPT START";
  const endMarker = "## SYSTEM PROMPT END";
  const startIdx = raw.indexOf(startMarker);
  const endIdx = raw.indexOf(endMarker);
  if (startIdx === -1) {
    // No markers — use whole file (backward compat)
    return raw.trim();
  }
  const body = raw.slice(startIdx + startMarker.length, endIdx === -1 ? undefined : endIdx);
  return body.trim();
}

const SYSTEM_PROMPT = parseSystemPrompt(RAW_PROMPT_FILE);

// ─────────────────────────────────────────────────────────────────────────────
// Rate limiting
// Groq free tier on llama-3.3-70b-versatile: 12K tokens/min (TPM) for on_demand tier.
// Each extraction call is ~1700 tokens (prompt+response). 12000/1700 ≈ 7 calls/min.
// 60s/7 ≈ 8.5s per call. We use 6s to stay safely under while not being too slow.
const RATE_LIMIT_MS = 6000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─────────────────────────────────────────────────────────────────────────────
// Extraction with retry
// ─────────────────────────────────────────────────────────────────────────────

const MODEL = process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile";
const MAX_RETRIES = 3;

async function extractFromClause(clauseRef: string, clauseText: string) {
  const userPrompt =
    `Clause reference: ${clauseRef}\n` +
    `Clause text:\n"""\n${clauseText}\n"""\n\n` +
    `Extract obligations per the rules above. Return only JSON.`;

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 1) {
      // Exponential backoff: 2s, 4s between retries (on top of rate limiting)
      await sleep(RATE_LIMIT_MS * attempt);
    }

    let raw = "{}";
    try {
      const completion = await groq.chat.completions.create({
        model: MODEL,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        temperature: 0,
        response_format: { type: "json_object" },
      });
      raw = completion.choices[0]?.message?.content ?? "{}";
    } catch (err) {
      // Groq API error (rate limit, timeout, etc.)
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`  [warn] Groq API error on attempt ${attempt}/${MAX_RETRIES}: ${msg}`);
      lastError = err instanceof Error ? err : new Error(msg);
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (_parseErr) {
      // Malformed JSON — ask the model to repair it
      if (attempt < MAX_RETRIES) {
        console.warn(`  [warn] Malformed JSON on attempt ${attempt}, requesting repair...`);
        try {
          const repair = await groq.chat.completions.create({
            model: MODEL,
            messages: [
              { role: "system", content: SYSTEM_PROMPT },
              { role: "user", content: userPrompt },
              { role: "assistant", content: raw },
              {
                role: "user",
                content:
                  "The JSON above is malformed. Fix it and return only valid JSON matching the schema. No prose.",
              },
            ],
            temperature: 0,
            response_format: { type: "json_object" },
          });
          raw = repair.choices[0]?.message?.content ?? "{}";
          parsed = JSON.parse(raw);
        } catch (_repairErr) {
          lastError = new Error(`JSON repair failed: ${raw.slice(0, 200)}`);
          continue;
        }
      } else {
        lastError = new Error(`Failed to parse model output as JSON: ${raw.slice(0, 200)}`);
        continue;
      }
    }

    const result = ExtractionResultSchema.safeParse(parsed);
    if (!result.success) {
      lastError = new Error(
        `Model output schema mismatch (attempt ${attempt}): ${result.error.message}`
      );
      // Schema mismatch is usually not fixed by retrying — break early
      break;
    }

    return result.data.obligations;
  }

  // All attempts failed
  throw lastError ?? new Error("Extraction failed after all retries.");
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
  const circularId = getArg("--circular-id");
  const dryRun = hasFlag("--dry-run");
  const limitArg = getArg("--limit");
  const limit = limitArg ? parseInt(limitArg, 10) : Infinity;

  if (!circularId) {
    console.error(
      "Usage:\n" +
        "  npm run extract -- --circular-id <uuid>\n" +
        "  npm run extract -- --circular-id <uuid> --dry-run\n" +
        "  npm run extract -- --circular-id <uuid> --limit 5"
    );
    process.exit(1);
  }

  const { rows: clauses } = await pool.query(
    "SELECT id, clause_ref, text FROM clauses WHERE circular_id = $1 ORDER BY clause_ref",
    [circularId]
  );

  if (clauses.length === 0) {
    console.error(`No clauses found for circular ${circularId}. Run ingestion first.`);
    process.exit(1);
  }

  const toProcess = clauses.slice(0, limit === Infinity ? clauses.length : limit);
  console.log(
    `[info] Extracting obligations from ${toProcess.length}/${clauses.length} clauses` +
      (dryRun ? " (DRY RUN — no DB writes)" : "") +
      "..."
  );
  console.log(`[info] Model: ${MODEL} | Rate limit: ${RATE_LIMIT_MS}ms between calls`);

  if (!dryRun) {
    // Idempotent: clear existing obligations for this circular before re-inserting
    const { rowCount } = await pool.query(
      "DELETE FROM obligations WHERE circular_id = $1",
      [circularId]
    );
    if (rowCount && rowCount > 0) {
      console.log(`[info] Cleared ${rowCount} existing obligations for circular ${circularId}.`);
    }
  }

  let totalObligations = 0;
  let skippedClauses = 0;
  let failedClauses = 0;

  for (let i = 0; i < toProcess.length; i++) {
    const clause = toProcess[i];
    const progress = `[${i + 1}/${toProcess.length}]`;

    // Rate limiting: sleep before every call except the first
    if (i > 0) await sleep(RATE_LIMIT_MS);

    let obligations;
    try {
      obligations = await extractFromClause(clause.clause_ref, clause.text);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  ${progress} clause ${clause.clause_ref}: FAILED — ${msg}`);
      failedClauses++;
      continue;
    }

    if (obligations.length === 0) {
      console.log(`  ${progress} clause ${clause.clause_ref}: 0 obligations (no-op clause)`);
      skippedClauses++;
      continue;
    }

    console.log(
      `  ${progress} clause ${clause.clause_ref}: ${obligations.length} obligation(s)`
    );

    if (dryRun) {
      obligations.forEach((ob, j) => {
        console.log(
          `    [${j + 1}] (conf=${ob.confidence.toFixed(2)}) ${ob.obligation_summary.slice(0, 100)}`
        );
      });
    } else {
      for (const ob of obligations) {
        await pool.query(
          `INSERT INTO obligations
             (circular_id, clause_id, intermediary_category, obligation_summary,
              action_required, frequency, deadline_rule, evidence_type,
              extracted_by_model, extraction_confidence)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            circularId,
            clause.id,
            ob.intermediary_category,
            ob.obligation_summary,
            ob.action_required,
            ob.frequency,
            ob.deadline_rule,
            ob.evidence_type,
            MODEL,
            ob.confidence,
          ]
        );
      }
    }

    totalObligations += obligations.length;
  }

  console.log(
    `\n[ok] Done. ${totalObligations} obligation(s) extracted from ${toProcess.length} clauses.`
  );
  console.log(
    `     ${skippedClauses} no-op clauses | ${failedClauses} failed | ` +
      `${toProcess.length - skippedClauses - failedClauses} produced obligations`
  );

  if (!dryRun && totalObligations > 0) {
    console.log(`[ok] Run eval_against_ground_truth.ts to compute recall.`);
  }

  await pool.end();
}

main().catch((err) => {
  console.error("[fatal]", err);
  process.exit(1);
});
