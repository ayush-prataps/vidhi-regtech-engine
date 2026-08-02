# Vidhi — Architecture & System Design

```
                     +-----------------------------------+
                     |  SEBI Master Circular (PDF Text)  |
                     +-----------------------------------+
                                       |
                                       v
                    +-------------------------------------+
                    |       packages/ingestion            |
                    |  - 4-level dotted clause chunker    |
                    |  - Appendix rescission parser       |
                    |  - Ground-truth table parser        |
                    +-------------------------------------+
                                       |
                                       v
                     +-----------------------------------+
                     |       clauses & appendix tables   |
                     |       (Neon Serverless Postgres)  |
                     +-----------------------------------+
                                       |
                                       v
                    +-------------------------------------+
                    |       packages/extraction           |
                    |  - Groq LLM Extraction Engine       |
                    |  - 5 Few-shot grounded prompt       |
                    |  - 100% Scoped Recall Validation    |
                    +-------------------------------------+
                                       |
                                       v
                    +-------------------------------------+
                    |          obligations table          |
                    +-------------------------------------+
                                       |
                   +-------------------+-------------------+
                   |                                       |
                   v                                       v
    +------------------------------+       +------------------------------+
    |    packages/diff-engine      |       |          apps/web            |
    | - Bigram Jaccard matching    |       |  Next.js 16 Production App   |
    | - Keyword classifier         | ----> |  - Obligations Graph View    |
    | - Appendix rescission lookup |       |  - Gap Alerts Dashboard      |
    | writes obligation_versions   |       |  - Version Diffs Explorer    |
    +------------------------------+       |  - Evidence Mapping & Review |
                                           +------------------------------+
                                                           |
                                                           v
                                           Deployed on Vercel
                                           https://vidhi-regtech-engine-web.vercel.app
```

---

## Core Design Principles

1. **Strictly Grounded Extraction**:
   - The LLM extraction pass (`packages/extraction`) is constrained to extract and cite verbatim text. The model never generates ungrounded rules or plausible-sounding fabrications. If a clause contains no mandatory action, an empty array is returned.
   - Every obligation row contains a mandatory foreign key citation to `clause_id` and `circular_id`.

2. **Cross-Version Clause Correlation**:
   - Regulatory amendments frequently renumber circular chapters. `packages/diff-engine` uses **bigram Jaccard similarity** on normalized clause text combined with a keyword classifier (`RESCISSION_PAT`, `INSERTION_PAT`) and appendix lookup to reliably detect `new`, `amended`, and `repealed` obligations across document versions.

3. **Human-in-the-Loop Governance**:
   - High-risk or ambiguous rules are assigned a `needs_review` status badge in the UI (`apps/web`), allowing compliance officers to explicitly verify and approve extracted obligations before marking them `active`.

4. **Real-Time Compliance Gap Management**:
   - Obligations without attached operational evidence are flagged as active compliance gaps. When compliance officers attach proof (text/document link), the system updates gap status in real time.

---

## Data Model & Schema (`db/schema.sql`)

* **`circulars`**: Ingested SEBI master circular versions (title, circular number, issued date, intermediary category).
* **`clauses`**: Paragraph chunks preserving exact numbering citations (`clause_ref`, `text`).
* **`obligations`**: Grounded obligations extracted by LLM (`obligation_summary`, `action_required`, `frequency`, `deadline_rule`, `evidence_type`, `status`, `confidence`).
* **`obligation_versions`**: Version diff history (`change_type`: `new` | `amended` | `repealed`, `diff_summary`).
* **`evidence`**: Intermediary-submitted proof records linked to specific obligations.
* **`appendix_circulars`**: Parsed appendix list of superseded circulars with preamble rescission flags.
* **`reporting_ground_truth`**: Official SEBI-authored reporting requirements table for recall evaluation.

---

## Production Deployment Infrastructure

* **Database Layer**: Neon Serverless PostgreSQL with `pgvector` enabled.
* **API & Frontend Layer**: Next.js 16 (App Router, Turbopack) deployed on Vercel.
* **LLM Engine**: Groq API (`llama-3.3-70b-versatile` / `llama-3.1-8b-instant`).
* **Deterministic Seeding**: `scripts/seed_demo.ts` (`npm run seed`) loads all 111 clauses, 114 obligations, 69 version diffs, and evidence items into any PostgreSQL database in < 2 seconds.
