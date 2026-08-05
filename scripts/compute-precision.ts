/**
 * Task 1: Companion script to compute precision from labeled obligations.
 * Reads scripts/obligations_for_review.json and computes:
 *   precision = TP / (TP + FP)
 * Reports 'uncertain' rows separately.
 *
 * Usage:
 *   npx tsx scripts/compute-precision.ts
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const jsonPath = path.join(__dirname, "obligations_for_review.json");

if (!fs.existsSync(jsonPath)) {
  console.error(`[fatal] Labeled file not found at: ${jsonPath}`);
  console.error("Run 'npx tsx scripts/export-obligations-for-review.ts' first.");
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));

let tp = 0;
let fp = 0;
let uncertain = 0;
let unlabeled = 0;

for (const item of data) {
  const lbl = (item.label || "").trim().toUpperCase();
  if (lbl === "TP") {
    tp++;
  } else if (lbl === "FP") {
    fp++;
  } else if (lbl === "UNCERTAIN") {
    uncertain++;
  } else {
    unlabeled++;
  }
}

const totalLabeled = tp + fp;
const precision = totalLabeled > 0 ? (tp / totalLabeled) * 100 : 0;

console.log("════════════════════════════════════════════════════════════");
console.log("EXTRACTION PRECISION EVALUATION RESULTS");
console.log("════════════════════════════════════════════════════════════");
console.log(`Total Obligations Reviewed : ${data.length}`);
console.log(`True Positives (TP)        : ${tp}`);
console.log(`False Positives (FP)       : ${fp}`);
console.log(`Uncertain Rows             : ${uncertain}`);
console.log(`Unlabeled Rows             : ${unlabeled}`);
console.log("------------------------------------------------------------");
console.log(`PRECISION                  : ${precision.toFixed(1)}% (${tp}/${totalLabeled})`);
console.log("════════════════════════════════════════════════════════════");

if (unlabeled > 0) {
  console.warn(`\n[warn] ${unlabeled} obligation(s) remain unlabeled in ${jsonPath}`);
}
