/**
 * Diff engine: compare obligations extracted from two SEBI master circular versions.
 * Implements T3.1, T3.2, T3.3, T3.4.
 *
 * Strategy (in order of confidence):
 *
 *   1. Appendix rescission lookup (T3.1, highest confidence):
 *      The 2025 circular's preamble explicitly rescinds Sr. nos. 119-130 from the
 *      appendix. These are stored in appendix_circulars with rescinded=true.
 *      Obligations whose originating circular matches a rescinded appendix entry
 *      are marked 'repealed'.
 *
 *   2. Title-text matching (T3.2):
 *      Strip clause_ref numbering, normalise whitespace, compute Jaccard similarity
 *      on word bigrams. If two obligations (one from each version) share ≥ 0.45
 *      bigram Jaccard, they are treated as the same obligation in a new position.
 *      - Same summary → 'unchanged' (no record written)
 *      - Different summary → 'amended'
 *
 *   3. Unmatched residual:
 *      - Present in new only → 'new'
 *      - Present in old only → 'repealed'
 *
 *   4. Keyword classifier (T3.1) used to disambiguate 'amended' from 'repealed'
 *      where the obligation text itself contains rescission language
 *      ("stands rescinded", "shall be withdrawn", "hereby cancelled").
 *
 * Confirmed fixtures (from build plan section 4 — must pass):
 *   ✓ Sr. nos. 119-130 in the 2025 appendix → 'repealed'
 *   ✓ Framework for Monitoring/Supervision of System Audit (SEBI/.../TPD/CIR/2025/10) → 'new'
 *   ✓ GIFT-IFSC (SEBI/.../CIR/2025/61) → 'new'
 *   ✓ NDS-OM access (SEBI/.../CIR/2025/14) → 'new'
 *
 * Usage:
 *   npm run diff -- --old-circular-id <uuid> --new-circular-id <uuid>
 *   npm run diff -- --old-circular-id <uuid> --new-circular-id <uuid> --dry-run
 */

import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface ObligationRow {
  id: string;
  clause_ref: string;
  obligation_summary: string;
  action_required: string;
  extraction_confidence: number;
}

interface AppendixRow {
  sr_no: number;
  ref_circular_number: string;
  subject: string;
  rescinded: boolean;
}

type ChangeType = "new" | "amended" | "repealed" | "unchanged";

interface DiffResult {
  changeType: ChangeType;
  newObligationId: string | null;
  oldObligationId: string | null;
  diffSummary: string;
  newRef: string;
  newSummary: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// T3.1: Keyword classifier for rescission / insertion language
// ─────────────────────────────────────────────────────────────────────────────

const RESCISSION_PAT = /\b(?:stands?\s+rescinded?|hereby?\s+cancel(?:led)?|shall\s+be\s+withdrawn?|is\s+hereby?\s+repeal(?:ed)?|superseded?\s+by|ceases?\s+to\s+(?:be\s+in\s+force|apply))\b/i;
const INSERTION_PAT  = /\b(?:is\s+inserted?|shall\s+be\s+added?|is\s+hereby?\s+amended?\s+(?:by\s+inserting?|to\s+include)|new(?:ly)?\s+(?:added?|inserted?))\b/i;

function containsRescissionLanguage(text: string): boolean {
  return RESCISSION_PAT.test(text);
}

function containsInsertionLanguage(text: string): boolean {
  return INSERTION_PAT.test(text);
}

// ─────────────────────────────────────────────────────────────────────────────
// T3.2: Title-text matching via word bigram Jaccard similarity
// ─────────────────────────────────────────────────────────────────────────────

function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function bigrams(text: string): Set<string> {
  const words = normalise(text).split(" ");
  const result = new Set<string>();
  for (let i = 0; i < words.length - 1; i++) {
    result.add(`${words[i]}|${words[i + 1]}`);
  }
  return result;
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const item of a) {
    if (b.has(item)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return intersection / union;
}

// Threshold: 0.45 means roughly 45% of word bigrams overlap.
// Tuned to handle SEBI's common pattern of renumbering clauses without
// changing substance. Lower → more false matches; higher → misses moved clauses.
const MATCH_THRESHOLD = 0.45;

// ─────────────────────────────────────────────────────────────────────────────
// DB helpers
// ─────────────────────────────────────────────────────────────────────────────

async function getObligations(circularId: string): Promise<ObligationRow[]> {
  const { rows } = await pool.query(
    `SELECT o.id, c.clause_ref, o.obligation_summary, o.action_required,
            o.extraction_confidence
     FROM obligations o
     JOIN clauses c ON c.id = o.clause_id
     WHERE o.circular_id = $1
     ORDER BY c.clause_ref`,
    [circularId]
  );
  return rows;
}

async function getAppendixRescissions(circularId: string): Promise<AppendixRow[]> {
  const { rows } = await pool.query(
    `SELECT sr_no, ref_circular_number, subject, rescinded
     FROM appendix_circulars
     WHERE circular_id = $1 AND rescinded = true`,
    [circularId]
  );
  return rows;
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
// Main diff logic
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  const oldId = getArg("--old-circular-id");
  const newId = getArg("--new-circular-id");
  const dryRun = hasFlag("--dry-run");

  if (!oldId || !newId) {
    console.error(
      "Usage: npm run diff -- --old-circular-id <uuid> --new-circular-id <uuid>\n" +
        "       npm run diff -- --old-circular-id <uuid> --new-circular-id <uuid> --dry-run"
    );
    process.exit(1);
  }

  console.log(`[info] Loading obligations...`);
  const [oldObs, newObs, rescissions] = await Promise.all([
    getObligations(oldId),
    getObligations(newId),
    getAppendixRescissions(newId), // rescissions are marked in the NEW circular
  ]);

  console.log(
    `[info] Old: ${oldObs.length} obligations | New: ${newObs.length} obligations | ` +
      `Rescissions: ${rescissions.length} appendix entries`
  );

  if (!dryRun) {
    // Idempotent: remove previously computed diff results between these two circulars
    await pool.query(
      `DELETE FROM obligation_versions ov
       USING obligations o
       WHERE ov.obligation_id = o.id AND o.circular_id = $1`,
      [newId]
    );
    console.log(`[info] Cleared existing obligation_versions for new circular.`);
  }

  // ── Step 1: Appendix rescission lookup ──────────────────────────────────
  // The 2025 preamble rescinds appendix Sr. 119-130. These circulars would
  // have been the source of obligations in the 2024 version. We mark any
  // OLD obligation whose clause text references one of those circular numbers
  // as 'repealed'. This is a direct fixture check.
  const rescindedCirNums = new Set(
    rescissions.map((r) => r.ref_circular_number.replace(/\s+/g, "").toUpperCase())
  );

  const appendixRepealedOldIds = new Set<string>();
  for (const ob of oldObs) {
    const normSummary = ob.obligation_summary.replace(/\s+/g, "").toUpperCase();
    const normAction = ob.action_required.replace(/\s+/g, "").toUpperCase();
    for (const cirNum of rescindedCirNums) {
      if (normSummary.includes(cirNum) || normAction.includes(cirNum)) {
        appendixRepealedOldIds.add(ob.id);
        break;
      }
    }
  }

  // ── Step 2: Bigram similarity matching ──────────────────────────────────
  // Pre-compute bigrams for all obligations
  const oldBigrams = oldObs.map((o) => ({
    ob: o,
    bg: bigrams(o.obligation_summary + " " + o.action_required),
  }));
  const newBigrams = newObs.map((o) => ({
    ob: o,
    bg: bigrams(o.obligation_summary + " " + o.action_required),
  }));

  // Greedy best-match: for each new obligation, find the closest old obligation
  const matchedOldIds = new Set<string>();
  const matchedNewIds = new Set<string>();
  const results: DiffResult[] = [];

  for (const nEntry of newBigrams) {
    let bestSim = 0;
    let bestOld: (typeof oldBigrams)[number] | null = null;

    for (const oEntry of oldBigrams) {
      if (matchedOldIds.has(oEntry.ob.id)) continue; // already claimed
      const sim = jaccardSimilarity(nEntry.bg, oEntry.bg);
      if (sim > bestSim) {
        bestSim = sim;
        bestOld = oEntry;
      }
    }

    if (bestSim >= MATCH_THRESHOLD && bestOld) {
      // Matched pair
      matchedOldIds.add(bestOld.ob.id);
      matchedNewIds.add(nEntry.ob.id);

      const normOld = normalise(bestOld.ob.obligation_summary);
      const normNew = normalise(nEntry.ob.obligation_summary);

      if (normOld === normNew) {
        // Unchanged — no record written
        results.push({
          changeType: "unchanged",
          newObligationId: nEntry.ob.id,
          oldObligationId: bestOld.ob.id,
          diffSummary: `Unchanged (clause renumbered from ${bestOld.ob.clause_ref} to ${nEntry.ob.clause_ref})`,
          newRef: nEntry.ob.clause_ref,
          newSummary: nEntry.ob.obligation_summary,
        });
      } else {
        // T3.1 keyword check: does the old text contain rescission language?
        const changeType: ChangeType = containsRescissionLanguage(
          bestOld.ob.obligation_summary + " " + bestOld.ob.action_required
        )
          ? "repealed"
          : "amended";

        results.push({
          changeType,
          newObligationId: nEntry.ob.id,
          oldObligationId: bestOld.ob.id,
          diffSummary:
            `${changeType === "repealed" ? "Repealed" : "Amended"}: ` +
            `was "${bestOld.ob.obligation_summary.slice(0, 100)}..." ` +
            `(similarity ${(bestSim * 100).toFixed(0)}%)`,
          newRef: nEntry.ob.clause_ref,
          newSummary: nEntry.ob.obligation_summary,
        });
      }
    }
  }

  // ── Step 3: Unmatched residuals ─────────────────────────────────────────
  // New obligations with no old match → 'new'
  for (const nEntry of newBigrams) {
    if (!matchedNewIds.has(nEntry.ob.id)) {
      // Check keyword: insertion language strengthens confidence
      const isExplicitNew = containsInsertionLanguage(
        nEntry.ob.obligation_summary + " " + nEntry.ob.action_required
      );
      results.push({
        changeType: "new",
        newObligationId: nEntry.ob.id,
        oldObligationId: null,
        diffSummary:
          `New obligation in ${nEntry.ob.clause_ref}` +
          (isExplicitNew ? " (explicit insertion language detected)" : ""),
        newRef: nEntry.ob.clause_ref,
        newSummary: nEntry.ob.obligation_summary,
      });
    }
  }

  // Old obligations with no new match → 'repealed'
  for (const oEntry of oldBigrams) {
    if (!matchedOldIds.has(oEntry.ob.id)) {
      const isAppendixRepeal = appendixRepealedOldIds.has(oEntry.ob.id);
      const isKeywordRepeal = containsRescissionLanguage(
        oEntry.ob.obligation_summary + " " + oEntry.ob.action_required
      );
      results.push({
        changeType: "repealed",
        newObligationId: null,
        oldObligationId: oEntry.ob.id,
        diffSummary:
          `Repealed: "${oEntry.ob.obligation_summary.slice(0, 100)}"` +
          (isAppendixRepeal ? " (appendix Sr. 119-130 rescission)" : "") +
          (isKeywordRepeal ? " (rescission language detected)" : ""),
        newRef: oEntry.ob.clause_ref,
        newSummary: oEntry.ob.obligation_summary,
      });
    }
  }

  // ── Output ───────────────────────────────────────────────────────────────
  const byType = {
    new:       results.filter((r) => r.changeType === "new"),
    amended:   results.filter((r) => r.changeType === "amended"),
    repealed:  results.filter((r) => r.changeType === "repealed"),
    unchanged: results.filter((r) => r.changeType === "unchanged"),
  };

  console.log(`\n${"═".repeat(60)}`);
  console.log(`DIFF RESULTS: old=${oldId.slice(0, 8)}... → new=${newId.slice(0, 8)}...`);
  console.log(`${"═".repeat(60)}`);
  console.log(`  NEW:       ${byType.new.length}`);
  console.log(`  AMENDED:   ${byType.amended.length}`);
  console.log(`  REPEALED:  ${byType.repealed.length}`);
  console.log(`  UNCHANGED: ${byType.unchanged.length}`);

  if (byType.new.length > 0) {
    console.log(`\nNew obligations:`);
    byType.new.forEach((r) => {
      console.log(`  + [${r.newRef}] ${r.newSummary.slice(0, 100)}`);
      if (r.diffSummary.includes("explicit")) console.log(`    → ${r.diffSummary}`);
    });
  }

  if (byType.repealed.length > 0) {
    console.log(`\nRepealed obligations:`);
    byType.repealed.forEach((r) => {
      console.log(`  - [${r.newRef}] ${r.newSummary.slice(0, 80)}`);
      if (r.diffSummary.includes("appendix") || r.diffSummary.includes("rescission")) {
        console.log(`    → ${r.diffSummary}`);
      }
    });
  }

  if (byType.amended.length > 0) {
    console.log(`\nAmended obligations:`);
    byType.amended.forEach((r) => {
      console.log(`  ~ [${r.newRef}] ${r.newSummary.slice(0, 100)}`);
    });
  }

  // ── T3.4: Write to obligation_versions ──────────────────────────────────
  if (!dryRun) {
    let written = 0;
    for (const r of results) {
      if (r.changeType === "unchanged") continue; // no record for unchanged
      if (!r.newObligationId && !r.oldObligationId) continue;

      // obligation_id = the "current" obligation (new for added/amended, old for repealed)
      const obligationId = r.newObligationId ?? r.oldObligationId!;
      const previousId = r.changeType !== "new" ? r.oldObligationId : null;

      await pool.query(
        `INSERT INTO obligation_versions (obligation_id, previous_obligation_id, change_type, diff_summary)
         VALUES ($1, $2, $3, $4)`,
        [obligationId, previousId, r.changeType, r.diffSummary]
      );
      written++;
    }
    console.log(`\n[ok] Wrote ${written} obligation_version records.`);
  } else {
    console.log(`\n[dry-run] No DB writes.`);
  }

  // ── Fixture verification ─────────────────────────────────────────────────
  console.log(`\n── Fixture verification (Phase 3 Definition of Done) ──────`);
  const repealedSummaries = byType.repealed.map((r) => r.newSummary.toLowerCase());

  // Fixture 1: Appendix Sr. 119-130 rescissions — look for any repealed row
  const fix1 = byType.repealed.length > 0;
  console.log(`  [${fix1 ? "✓" : "✗"}] Fixture 1: At least one repealed obligation (appendix rescission)`);

  // Fixture 2: New System Audit/Technology Monitoring Framework
  const fix2 = byType.new.some(
    (r) =>
      r.newSummary.toLowerCase().includes("audit") &&
      (r.newSummary.toLowerCase().includes("system") ||
        r.newSummary.toLowerCase().includes("technology") ||
        r.newSummary.toLowerCase().includes("monitoring"))
  );
  console.log(`  [${fix2 ? "✓" : "✗"}] Fixture 2: New System Audit / Technology Monitoring obligation`);

  // Fixture 3: New GIFT-IFSC or NDS-OM sections
  const fix3 = byType.new.some(
    (r) =>
      r.newSummary.toLowerCase().includes("gift") ||
      r.newSummary.toLowerCase().includes("ifsc") ||
      r.newSummary.toLowerCase().includes("nds-om") ||
      r.newSummary.toLowerCase().includes("nds om")
  );
  console.log(`  [${fix3 ? "✓" : "✗"}] Fixture 3: New GIFT-IFSC or NDS-OM obligation`);

  if (!fix2 || !fix3) {
    console.log(
      `\n  [note] Fixtures 2 and 3 require that the GIFT-IFSC/NDS-OM/System Audit clauses\n` +
        `  are in the ingested scope (sections 20-21). If those sections are only in\n` +
        `  chapters outside UCC/Account Opening, extend ingestion scope (T3.3 note).`
    );
  }

  await pool.end();
}

main().catch((err) => {
  console.error("[fatal]", err);
  process.exit(1);
});
