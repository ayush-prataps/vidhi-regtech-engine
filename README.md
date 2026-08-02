# Vidhi — Agentic Compliance Engine

Vidhi turns unstructured SEBI regulatory text (master circulars, notifications) into a
structured, versioned, machine-actionable obligation graph — with every obligation
grounded to its exact source clause. On top of that sits a compliance tracker that maps
obligations to intermediary evidence and flags gaps before an inspection does.

**Live Production Prototype**: [https://vidhi-regtech-engine-web.vercel.app](https://vidhi-regtech-engine-web.vercel.app)

**Status: Production Prototype.** The ingestion → extraction → diff pipeline, cloud database, and Next.js compliance tracker UI are fully implemented and validated against the official SEBI ground truth table.

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

3. **Compliance tracking UI** (`apps/web`) — the intermediary-facing surface where obligations
   get mapped to evidence, gaps get flagged in real time, and regulatory version changes are visually compared.

---

## Extraction quality & recall

Validated against SEBI's own official *Reporting Requirements* table (the ground truth
published in the circular itself):

| Metric | Value |
|---|---|
| Scoped recall (obligations in ingested chapters) | **100%** |
| Obligations extracted — 2025 circular | **82** |
| Obligations extracted — 2024 circular | **32** |
| Diff engine fixtures verified | **3/3** ✅ |

Scoped recall measures what fraction of SEBI's own listed reporting obligations were
independently extracted by the LLM pipeline, within the chapters that were ingested.
Full-circular recall is lower by design (38 of 39 ground truth rows are in chapters
outside the current ingestion scope).

---

## Diff engine fixtures (verified)

The diff engine correctly identifies all three confirmed real changes between the
August 2024 and June 2025 master circulars for stock brokers:

| Fixture | Change | Status |
|---|---|---|
| Appendix Sr. nos. 119-130 | Repealed (rescinded in 2025 preamble) | ✅ |
| Section 17 — System Audit Framework via Technology | New (2025 only) | ✅ |
| Section 71 — GIFT-IFSC Separate Business Unit | New (2025 only) | ✅ |
| Section 72 — NDS-OM access facilitation | New (2025 only) | ✅ |

---

## Repo layout

```
vidhi-regtech-engine/
├── packages/ingestion/     PDF → clause-chunked text (pdf-parse, chapter-scoped)
├── packages/extraction/    Chunked text → grounded obligation records (Groq/Llama)
├── packages/diff-engine/   Obligation version diffing (bigram Jaccard + keyword classifier)
├── apps/web/               Next.js 16 compliance tracker UI (deployed on Vercel)
├── scripts/                Seed scripts & dataset generators
├── db/                     Postgres schema, migrations (deployed on Neon)
├── docs/                   Build plan, architecture notes
└── RESULTS.md              Extraction recall metrics (auto-generated)
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

---

## Pipeline & UI commands

**Ingest a circular** (chunk PDF into clause records):
```bash
cd packages/ingestion

npm run chunk -- \
  --file data/raw/sebi/stockbrokers/17-06-2025-Master-Circular.pdf \
  --title "Master Circular for Stock Brokers 2025" \
  --circular-number "SEBI/HO/MIRSD/MIRSD-PoD/P/CIR/2025/90" \
  --date 2025-06-17 \
  --intermediary stockbroker

# Parse ground truth tables (for eval)
npm run parse-reporting -- --file <pdf> --circular-id <uuid> --version 2025-06-17
npm run parse-appendix  -- --file <pdf> --circular-id <uuid> --version 2025-06-17
```

**Extract obligations** (LLM pass over each clause):
```bash
cd packages/extraction

npm run extract -- --circular-id <uuid>
npm run extract -- --circular-id <uuid> --dry-run   # preview, no DB writes
npm run extract -- --circular-id <uuid> --limit 5   # spot-check first 5 clauses

# Evaluate extraction recall against SEBI ground truth
npm run eval -- --circular-id <uuid>
```

**Run the diff engine** (compare two circular versions):
```bash
cd packages/diff-engine

npm run diff -- \
  --old-circular-id <2024-uuid> \
  --new-circular-id <2025-uuid> \
  --dry-run      # verify fixtures before writing to DB

npm run diff -- \
  --old-circular-id <2024-uuid> \
  --new-circular-id <2025-uuid>  # writes to obligation_versions table
```

**Run the Compliance Tracker UI locally**:
```bash
cd apps/web
npm run dev
# Open http://localhost:3000
```

---

## What's implemented

| Component | Status |
|---|---|
| DB schema (circulars, clauses, obligations, evidence, obligation_versions) | ✅ Production-ready (Neon Cloud + Local) |
| Clause chunking (4-level dotted numbering, chapter-scoped, idempotent) | ✅ Tested on real SEBI PDFs |
| Appendix parsing (128 rows, rescission flags) | ✅ |
| Reporting Requirements ground truth parsing (39 rows) | ✅ |
| Obligation extraction (Groq/Llama, rate-limited, retry, JSON repair) | ✅ 82 + 32 obligations extracted |
| Extraction recall evaluation (scoped, chapter-aware) | ✅ 100% scoped recall |
| Diff engine (bigram Jaccard + keyword classifier + appendix rescission) | ✅ All 3 fixtures verified |
| Compliance tracker UI (Obligations Graph, Gap Alerts, Evidence Mapping, Version Diffs) | ✅ Fully implemented (Next.js 16) |
| Deterministic seed script (`npm run seed`) & Production Deployment | ✅ Live on Vercel + Neon Cloud |

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