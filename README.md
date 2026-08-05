# Vidhi — Agentic Compliance Engine

Vidhi turns unstructured SEBI regulatory text (master circulars, notifications) into a
structured, versioned, machine-actionable obligation graph — with every obligation
grounded to its exact source clause. On top of that sits a compliance tracker that maps
obligations to intermediary evidence, logs an append-only audit trail, and flags gaps before an inspection does.

🚀 **Live Production Prototype**: [https://vidhi-regtech-engine-web.vercel.app](https://vidhi-regtech-engine-web.vercel.app)

**Status: Production Prototype.** The ingestion → extraction → diff pipeline, cloud database, and Next.js compliance tracker UI are fully implemented and evaluated.

---

## What it does

Two problems, two pipelines, one shared store:

1. **Regulatory translation** (`packages/ingestion` + `packages/extraction`) — turns a
   circular PDF into clause-level chunks, then into obligation records via LLM extraction
   that is *grounded*, not generative. The model extracts and cites; it never invents an
   obligation that isn't backed by an exact source paragraph.

2. **Version diffing** (`packages/diff-engine`) — whenever a new circular version comes
   in, it diffs obligations against the prior version using bigram Jaccard similarity
   matching (not fragile clause-number matching) and flags what changed: new, amended,
   or repealed obligations.

3. **Compliance tracking & Audit UI** (`apps/web`) — the intermediary-facing surface where obligations
   get mapped to evidence, gaps get flagged in real time, regulatory version changes are visually compared, and immutable compliance audit logs are tracked.

---

## Rigorous Evaluation Metrics (`RESULTS.md`)

Validated against all 114 extracted obligations, human sampling, and SEBI's official *Reporting Requirements* ground-truth table:

| Metric | Value | Details / Methodology |
|---|---|---|
| **Extraction Precision** | **92.0%** | 104 True Positives / 113 Evaluated (1 Uncertain) |
| **Version Diff Agreement Rate** | **95.0%** | 19 Agreed / 20 Random Sampled Records |
| **Analysis Efficiency Gain** | **90x Faster** | 42 min manual PDF scan vs 28 sec Vidhi dashboard (**98.9% time reduction**) |
| **Scoped Recall** | **100.0%** | 1/1 In-Scope Reporting Obligation Matched |
| Ground-Truth Fixtures Verified | **3/3** ✅ | Appendix Sr 119-130, System Audit Sec 17, GIFT-IFSC & NDS-OM SBUs |
| Total Extracted Obligations | **114** | 82 for 2025 Circular + 32 for 2024 Circular |

> **Methodology Note**: Precision and recall were manually evaluated by the author against verbatim source clause text across all extracted obligations. Scoped recall measures extraction within ingested focus chapters (Sections 17, 20, 21, 71, 72). Full-circular recall is 2.6% (1/39) by design because 38 of SEBI's 39 reporting table rows belong to un-ingested chapters.

---

## Diff Engine Fixtures (Verified)

The diff engine correctly identifies all three confirmed real changes between the
August 2024 and June 2025 master circulars for stock brokers:

| Fixture | Change | Status |
|---|---|---|
| Appendix Sr. nos. 119-130 | Repealed (rescinded in 2025 preamble) | ✅ |
| Section 17 — System Audit Framework via Technology | New (2025 only) | ✅ |
| Section 71 — GIFT-IFSC Separate Business Unit | New (2025 only) | ✅ |
| Section 72 — NDS-OM access facilitation | New (2025 only) | ✅ |

---

## Repo Layout

```
vidhi-regtech-engine/
├── packages/ingestion/     PDF → clause-chunked text (pdf-parse, chapter-scoped)
├── packages/extraction/    Chunked text → grounded obligation records (Groq/Llama)
├── packages/diff-engine/   Obligation version diffing (bigram Jaccard + keyword classifier)
├── apps/web/               Next.js 16 compliance tracker UI (deployed on Vercel)
├── scripts/                Seed scripts, evaluation, & E2E smoke tests
├── db/                     Postgres schema, migrations (deployed on Neon)
├── docs/                   Architecture & design notes
└── RESULTS.md              Precision, recall, diff agreement, & efficiency benchmarks
```

---

## Setup & Demo Seeding

Prereqs: Node 20+, Postgres (Local or Neon Cloud), Groq API key.

```bash
cp .env.example .env
# fill in DATABASE_URL and GROQ_API_KEY

npm install --workspaces
```

### Seed Database (< 2 seconds)
To reset any database (Local or Neon Cloud) to a clean, demo-ready state with all 111 clauses, 114 obligations, 69 version diffs, and evidence items:

```bash
npm run seed
```

### Run Evaluation Scripts
```bash
# Compute extraction precision
npx tsx scripts/compute-precision.ts

# Compute version diff agreement rate
npx tsx scripts/compute-diff-agreement.ts

# Run E2E smoke test against production URL
npx tsx scripts/e2e-smoke.ts
```

---

## Tech Stack & Architecture

* **LLM Extraction**: Groq API (`llama-3.3-70b-versatile` / `llama-3.1-8b-instant`)
* **Cloud Database**: Neon Serverless PostgreSQL with `pgvector`
* **Frontend & Web API**: Next.js 16 (Turbopack, App Router) deployed on Vercel
* **Language & Runtime**: TypeScript, Node.js 20+

---

## Origin & Team

Built for the **SEBI Securities Market TechSprint 2026** at Global Fintech Fest, under the
**Agentic Compliance: From Regulatory Text to Operational Action** problem statement.

**Author**: Ayush Pratap Singh, B.Tech CSE, BML Munjal University.