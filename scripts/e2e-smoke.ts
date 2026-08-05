/**
 * Task 6: End-to-end QA smoke test against deployed production app on Vercel.
 *
 * Usage:
 *   npx tsx scripts/e2e-smoke.ts
 *   or: TARGET_URL="https://vidhi-regtech-engine-web.vercel.app" npx tsx scripts/e2e-smoke.ts
 */

const TARGET_URL = (process.env.TARGET_URL || "https://vidhi-regtech-engine-web.vercel.app").replace(/\/$/, "");

async function runSmokeTest() {
  console.log(`\n🚀 Starting End-to-End QA Smoke Test against: ${TARGET_URL}\n`);

  let passed = 0;
  let failed = 0;

  async function check(name: string, fn: () => Promise<void>) {
    try {
      await fn();
      console.log(`  ✅ [PASS] ${name}`);
      passed++;
    } catch (err: any) {
      console.error(`  ❌ [FAIL] ${name}:`, err?.message || err);
      failed++;
    }
  }

  // 1. Homepage HTML
  await check("GET / (Homepage HTML)", async () => {
    const res = await fetch(`${TARGET_URL}/`);
    if (res.status !== 200) throw new Error(`Status ${res.status}`);
    const text = await res.text();
    if (!text.includes("Vidhi") && !text.includes("Obligations")) {
      throw new Error("Homepage content missing expected branding/elements");
    }
  });

  // 2. API Obligations list
  let sampleObligationId = "";
  await check("GET /api/obligations (Obligations JSON List)", async () => {
    const res = await fetch(`${TARGET_URL}/api/obligations`);
    if (res.status !== 200) throw new Error(`Status ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data.obligations) || data.obligations.length === 0) {
      throw new Error("No obligations returned");
    }
    sampleObligationId = data.obligations[0].id;
    console.log(`      Found ${data.obligations.length} total obligations in production DB.`);
  });

  // 3. API Obligation detail with grounded clause text
  await check(`GET /api/obligations/${sampleObligationId} (Obligation Detail)`, async () => {
    const res = await fetch(`${TARGET_URL}/api/obligations/${sampleObligationId}`);
    if (res.status !== 200) throw new Error(`Status ${res.status}`);
    const data = await res.json();
    if (!data.obligation || !data.obligation.clause_text) {
      throw new Error("Missing obligation or grounded clause_text");
    }
  });

  // 4. API Version Changes list
  await check("GET /api/changes (Version Diffs)", async () => {
    const res = await fetch(`${TARGET_URL}/api/changes`);
    if (res.status !== 200) throw new Error(`Status ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data.changes) || data.changes.length === 0) {
      throw new Error("No version changes returned");
    }
    console.log(`      Found ${data.changes.length} version diff records.`);
  });

  // 5. POST /api/evidence & audit log verification
  await check("POST /api/evidence & Verify /api/audit (Evidence Attachment & Audit Log Hook)", async () => {
    const postRes = await fetch(`${TARGET_URL}/api/evidence`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        obligation_id: sampleObligationId,
        description: `E2E Smoke Test Evidence ${Date.now()}`,
        file_url: "https://example.com/e2e_test_doc.pdf",
      }),
    });
    if (postRes.status !== 201) {
      const errJson = await postRes.json();
      throw new Error(`POST /api/evidence failed (${postRes.status}): ${JSON.stringify(errJson)}`);
    }

    // Verify audit log received new entry
    const auditRes = await fetch(`${TARGET_URL}/api/audit`);
    if (auditRes.status !== 200) throw new Error(`GET /api/audit failed (${auditRes.status})`);
    const auditData = await auditRes.json();
    if (!Array.isArray(auditData.audit_logs) || auditData.audit_logs.length === 0) {
      throw new Error("Audit log is empty after evidence attachment");
    }
    const latest = auditData.audit_logs[0];
    if (latest.action !== "evidence_attached") {
      throw new Error(`Unexpected audit action: ${latest.action}`);
    }
  });

  // 6. UI Audit Log page
  await check("GET /audit (Audit Log UI Page)", async () => {
    const res = await fetch(`${TARGET_URL}/audit`);
    if (res.status !== 200) throw new Error(`Status ${res.status}`);
  });

  // Summary
  console.log("\n════════════════════════════════════════════════════════════");
  console.log(`E2E QA SMOKE TEST SUMMARY: ${passed} Passed, ${failed} Failed`);
  console.log("════════════════════════════════════════════════════════════\n");

  if (failed > 0) {
    process.exit(1);
  }
}

runSmokeTest().catch((err) => {
  console.error("[fatal] E2E Smoke test runner crashed:", err);
  process.exit(1);
});
