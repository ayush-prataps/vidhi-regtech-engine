# Vidhi — Agent Execution Spec (SEBI TechSprint 2026, Round 2)

Repo: https://github.com/ayush-prataps/vidhi-regtech-engine
Deadline: August 9, 2026 · Plan start: August 1, 2026 · 8 days, no slack

---

## 0. How to use this document (read this first, whether you are human or agent)

This file is written to be executed phase by phase by a coding agent (Cursor, Antigravity, Claude
Code, or a human working alone). Rules for whoever executes it:

1. **Work phases in order.** Do not start Phase N+1 until every task in Phase N's Definition of
   Done is checked off. Partial parallel work inside a phase is fine; skipping ahead across
   phases is not.
2. **Every task has an ID** (`T1.1`, `T1.2`, ...). When reporting progress, reference the ID, not
   a description, so status is unambiguous.
3. **Do not build anything in the "Explicitly out of scope" section**, even if it seems like a
   natural extension. That section exists because it was deliberately cut to fit an 11-day
   window. If a task in this document seems to require something from that list, stop and flag
   it rather than building around it silently.
4. **If blocked on a business/product decision** (not a technical one), stop and ask the human.
   Do not guess at scope. Technical implementation decisions within a task's stated constraints
   are the executor's call.
5. **Every phase ends with a runnable artifact**, not just written code. "Done" means the command
   in that phase's Definition of Done actually executes and produces the stated output.

---

## 1. Non-negotiable ground truth

- **Corpus files.** Two official SEBI master circulars are the entire data source for this round.
  No other regulatory text should be ingested.
  - `SEBI/HO/MIRSD/MIRSD-PoD/P/CIR/2025/90`, dated June 17, 2025 (current version)
  - `SEBI/HO/MIRSD/MIRSD-PoD-1/P/CIR/2024/110`, dated August 9, 2024 (prior version, needed for
    the diff engine)
- **Pre-flight (human task, before Phase 1 starts):** copy both PDFs into the repo at:
  ```
  data/circulars/2025-06-17-master-circular.pdf
  data/circulars/2024-08-09-master-circular.pdf
  ```
  These are not currently in the repo. An agent working from the repo alone cannot reach the
  original chat project files, so this copy step must happen first or Phase 1 cannot start.
- **Corpus scope for this round**, from both PDFs, both versions:
  - The "Reporting Requirements" chapter (final numbered chapter in both documents, table of
    paragraph numbers to reporting obligations, curated by SEBI itself).
  - Sections covering Unique Client Code and Trading Account Opening (numbered ~20-21 in the
    June 2025 version; numbers shift by 1 in the August 2024 version, do not assume identical
    numbering across the two files, that's exactly the problem Phase 3 exists to handle).
  - Nothing else in the ~200-page documents should be ingested this round.
- **Model/infra constraints**, do not substitute:
  - LLM: Groq API, `llama-3.3-70b-versatile`, temperature 0, JSON mode.
  - DB: Postgres + pgvector, schema already defined at `db/schema.sql`.
  - No other LLM provider this round (see Explicitly out of scope).

---

## 2. Explicitly out of scope for this round

Do not implement these even if a task seems to invite them. They were cut deliberately to fit 11
days without compromising the core deliverable (functional prototype + demo video):

- Gemini or any second LLM provider
- Embedding-similarity matching in the diff engine (title-text matching is the approved fallback)
- Full human-review workflow (a single flagged obligation in the demo is sufficient)
- Auth, multi-tenancy, RBAC
- Full audit-trail export
- Ingesting any part of the source documents beyond the two scoped chapters

---

## 3. Environment setup (run once, before Phase 1)

```bash
git clone https://github.com/ayush-prataps/vidhi-regtech-engine.git
cd vidhi-regtech-engine
cp .env.example .env
# fill in GROQ_API_KEY in .env before continuing

docker compose up -d
psql "$DATABASE_URL" -f db/schema.sql

npm install --workspaces
```

Verify before proceeding: `docker compose ps` shows postgres and redis healthy, and
`psql "$DATABASE_URL" -c '\dt'` lists the tables from `db/schema.sql`.

---

## Phase 1 (Jul 30 - Aug 1): Ingestion on real numbering

**Objective:** both circulars, both scoped chapters, chunked correctly and loaded into Postgres.

| ID | Task | Target file(s) |
|---|---|---|
| T1.1 | Extend the clause-header regex to handle 4-level dotted numbering (e.g. `36.7.1.1`) and lettered/roman sub-bullets (`a)`, `i)`, `ii)`) as distinct chunk boundaries | `packages/ingestion/src/chunk.ts` |
| T1.2 | Wire real PDF text extraction (`pdf-parse`, already a dependency) in place of the current stub | `packages/ingestion/src/chunk.ts` |
| T1.3 | Run chunking against both PDFs, both scoped chapters (Reporting Requirements + UCC/Account Opening) | -- |
| T1.4 | Insert resulting clauses into the `clauses` table, tagged with the correct `circular_id` for each of the two document versions | `packages/ingestion/src/chunk.ts` |
| T1.5 | Parse the "Appendix - List of Circulars/Communication" table from both PDFs into a structured lookup (new table or extend `clauses` with a `source_reference` field, executor's call) | new: `packages/ingestion/src/parse_appendix.ts` |
| T1.6 | Parse the "Reporting Requirements" table from both PDFs into a structured reference table, kept separate from `obligations` since this is ground truth, not model output | new: `db/migrations/002_reporting_ground_truth.sql`, `packages/ingestion/src/parse_reporting_table.ts` |

**Definition of Done:** `psql "$DATABASE_URL" -c "SELECT circular_id, count(*) FROM clauses GROUP BY circular_id;"` returns two rows with non-zero counts, one per document version. A separate query against the reporting ground-truth table returns the SEBI-authored list, not model output.

---

## Phase 2 (Aug 1 - Aug 3): Extraction, validated against SEBI's own table

**Objective:** obligations extracted from real clauses, with a measured recall number against
official ground truth.

| ID | Task | Target file(s) |
|---|---|---|
| T2.1 | Run `extract.ts` against all chunked clauses from the June 2025 version, both scoped chapters | `packages/extraction/src/extract.ts` |
| T2.2 | Write a comparison script that matches extracted obligations against the Reporting Requirements ground-truth table and computes recall (what fraction of SEBI's listed obligations were independently extracted) | new: `packages/extraction/src/eval_against_ground_truth.ts` |
| T2.3 | If recall is materially incomplete, add applicability-context injection: extract the circular's own applicability statement once and pass it as fixed context to every extraction call so the model has a default "who" to fall back on (this is the fix for clauses that use passive voice without naming a subject) | `packages/extraction/src/extract.ts`, `packages/extraction/src/prompts/obligation_extraction.md` |
| T2.4 | Re-run T2.1-T2.2 after the fix, confirm recall improved | -- |
| T2.5 | Manually spot-check 10-15 obligations from the UCC/Account Opening chapter (no official ground truth exists for this chapter, hand-checking is the only option here) | -- |

**Definition of Done:** `eval_against_ground_truth.ts` outputs a concrete recall percentage
against the official table, and that number is written down somewhere retrievable for the video
script (a `RESULTS.md` at repo root is fine).

---

## Phase 3 (Aug 4 - Aug 5): Diff engine, on the real document pair

**Objective:** correctly classify real changes between the two real circular versions.

| ID | Task | Target file(s) |
|---|---|---|
| T3.1 | Build the keyword classifier for rescission/insertion/amendment language ("stands rescinded," "is inserted," "shall be substituted," etc.) | `packages/diff-engine/src/diff.ts` |
| T3.2 | Implement title-text matching between clause sets from the two versions as the primary correlation strategy (not clause_ref alone, titles are stable across renumbering, numbers are not) | `packages/diff-engine/src/diff.ts` |
| T3.3 | Run the diff engine against the two real ingested versions, confirm it flags: the rescission of appendix items 119-130 as "cancelled," the new Section 17 (system audit technology monitoring framework) as "new" (present only in the June 2025 version), and the GIFT-IFSC/NDS-OM sections as "new" for the same reason | -- |
| T3.4 | Write the diff results into `obligation_versions` per the existing schema | `packages/diff-engine/src/diff.ts` |

**Definition of Done:** running the diff command against the two real circular IDs produces
output where all three confirmed real test cases (T3.3) are correctly classified. This is
checkable against ground truth you already know the answer to, don't skip verifying it.

---

## Phase 4 (Aug 6): Minimal tracker UI

**Objective:** a clickable interface, not raw JSON, since this is what the video shows.

| ID | Task | Target file(s) |
|---|---|---|
| T4.1 | Obligations table view: clause citation visible per row, filterable by chapter/category | `apps/web/app/page.tsx`, new components under `apps/web/app/obligations/` |
| T4.2 | Basic evidence-mapping input (text field is sufficient, no file upload) | `apps/web/app/obligations/[id]/` |
| T4.3 | Gap-alert view: obligations with zero linked evidence, surfaced as a distinct list | `apps/web/app/gaps/` |
| T4.4 | Route at least one obligation through `needs_review` status in the UI (visibly distinct from `active`) to demonstrate the system flagging uncertainty instead of guessing | `apps/web/app/api/obligations/route.ts`, UI status badge |
| T4.5 | Simple diff-view page showing the three confirmed real test cases from Phase 3 as a visible "what changed" list | new: `apps/web/app/changes/` |

**Definition of Done:** `npm run dev` in `apps/web`, and a human can click from the obligations
list, into an obligation, see its citation, add evidence, see it disappear from the gap-alert
list, and separately view the version-change page showing the three real diff cases.

---

## Phase 5 (Aug 7): Demo-ready state, not a video itself

An agent cannot record a video. This phase's job is to make the human's recording session as
frictionless as possible.

| ID | Task |
|---|---|
| T5.1 | Write a seed script that resets the DB to a clean, demo-ready state in one command (both circulars ingested, extraction run, diff computed, one obligation pre-flagged `needs_review`) |
| T5.2 | Write a `DEMO_SCRIPT.md` at repo root: a beat-by-beat walkthrough (problem statement -> approach -> key features -> live demo sequence) matching the actual working UI, so the human is reading a script that matches reality, not improvising |
| T5.3 | Do a full dry run of the demo sequence end to end, fix anything that breaks |

**Definition of Done:** running the seed script from a clean checkout, then following
`DEMO_SCRIPT.md` step by step, works without any manual database fiddling.

---

## Phase 6 (Aug 8): Submission, with Aug 9 as pure buffer

Human task, not agent. Checklist:

| ID | Task |
|---|---|
| T6.1 | Record the video following `DEMO_SCRIPT.md` |
| T6.2 | Update repo `README.md`: remove "stub" language for everything now real, list the actual recall number from Phase 2 |
| T6.3 | Fill the submission form, every field checked against the actual prototype, not aspirational copy |
| T6.4 | Submit on Aug 8. Aug 9 is buffer for form/upload issues only, not for finishing features |

---

## Stretch tier (only if core phases finish early, attempt in this order)

Do not start these until Phases 1-5 are fully done. If time remains after Phase 5:

1. Extend corpus to a third chapter (candidate: Margin Trading Facility, also clause-dense with
   clear deadlines)
2. Add the embedding-similarity fallback to the diff engine for clauses that both changed number
   and changed title
3. Add a second, illustrative cross-reference case beyond the appendix table lookup (one manually
   verified "in continuation of Circular X" inline reference, resolved and displayed in the UI)
4. Visual polish pass on the tracker UI

---

## 4. Confirmed real fixtures (use these exact facts, do not substitute invented examples)

- Rescission: circulars at Sr. nos. 119-130 of the June 2025 appendix, rescinded to the extent
  they relate to stock brokers, per that circular's own preamble.
- New section, June 2025 only: "Framework for Monitoring and Supervision of System Audit of
  Stock Brokers through Technology based Measures," referencing SEBI/HO/MIRSD/TPD/CIR/2025/10
  dated January 31, 2025.
- New sections, June 2025 only: GIFT-IFSC Separate Business Unit facilitation (referencing
  SEBI/HO/MIRSD/MIRSD-PoD/P/CIR/2025/61 dated May 2, 2025) and NDS-OM access facilitation
  (referencing SEBI/HO/MIRSD/MIRSD-PoD/P/CIR/2025/14 dated February 11, 2025).

These three are your ground truth for Phase 3 verification. If the diff engine disagrees with
these, the diff engine is wrong, not the fixtures.