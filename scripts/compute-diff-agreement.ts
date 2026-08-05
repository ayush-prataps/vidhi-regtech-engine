/**
 * Task 3: Companion script to compute diff agreement rate from sample review.
 * Reads scripts/diffs_for_review.json and computes:
 *   agreement_rate = yes / (yes + no)
 *
 * Usage:
 *   npx tsx scripts/compute-diff-agreement.ts
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const jsonPath = path.join(__dirname, "diffs_for_review.json");

if (!fs.existsSync(jsonPath)) {
  console.error(`[fatal] Labeled diff file not found at: ${jsonPath}`);
  console.error("Run 'npx tsx scripts/sample-diffs-for-review.ts' first.");
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));

let yes = 0;
let no = 0;
let unlabeled = 0;

for (const item of data) {
  const val = (item.agree || "").trim().toLowerCase();
  if (val === "yes" || val === "y" || val === "true") {
    yes++;
  } else if (val === "no" || val === "n" || val === "false") {
    no++;
  } else {
    unlabeled++;
  }
}

const totalReviewed = yes + no;
const agreementRate = totalReviewed > 0 ? (yes / totalReviewed) * 100 : 0;

console.log("════════════════════════════════════════════════════════════");
console.log("VERSION DIFF ENGINE AGREEMENT EVALUATION RESULTS");
console.log("════════════════════════════════════════════════════════════");
console.log(`Total Sampled Records      : ${data.length}`);
console.log(`Human Agreed (yes)         : ${yes}`);
console.log(`Human Disagreed (no)       : ${no}`);
console.log(`Unlabeled Sample Rows      : ${unlabeled}`);
console.log("------------------------------------------------------------");
console.log(`DIFF AGREEMENT RATE       : ${agreementRate.toFixed(1)}% (${yes}/${totalReviewed})`);
console.log("════════════════════════════════════════════════════════════");

if (unlabeled > 0) {
  console.warn(`\n[warn] ${unlabeled} diff sample row(s) remain unlabeled in ${jsonPath}`);
}
