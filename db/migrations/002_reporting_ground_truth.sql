-- Migration 002: ground truth tables for Phase 2 recall measurement and Phase 3 diff validation.
-- Run: psql "$DATABASE_URL" -f db/migrations/002_reporting_ground_truth.sql
--
-- These tables store SEBI-authored data, NOT model output.
-- They are the ground truth against which extraction (Phase 2) and diff (Phase 3) are validated.

-- ─────────────────────────────────────────────────────────────────────────────
-- reporting_ground_truth
--
-- SEBI's own Reporting Requirements table, parsed from both master circulars.
-- Each row is one reporting obligation as listed in the official table.
-- Used in eval_against_ground_truth.ts (T2.2) to compute extraction recall.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reporting_ground_truth (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    circular_id     UUID NOT NULL REFERENCES circulars(id) ON DELETE CASCADE,
    para_number     TEXT NOT NULL,       -- paragraph/clause reference from the table (e.g. "20.1")
    description     TEXT NOT NULL,       -- reporting obligation description as written by SEBI
    to_whom         TEXT,                -- recipient of the report (e.g. "Stock Exchange", "SEBI")
    frequency       TEXT,                -- as stated in the table ("Monthly", "Quarterly", "On event")
    format_ref      TEXT,                -- Annexure or format reference if given
    parsed_from     TEXT NOT NULL,       -- which source doc: '2025-06-17' or '2024-08-09'
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS rgt_circular_idx ON reporting_ground_truth (circular_id);
CREATE UNIQUE INDEX IF NOT EXISTS rgt_para_circular_idx
    ON reporting_ground_truth (circular_id, para_number);

-- ─────────────────────────────────────────────────────────────────────────────
-- appendix_circulars
--
-- The "Appendix — List of Circulars/Communications" table from both master circulars.
-- Each row is one superseded circular listed in the appendix.
-- Key use: Phase 3 diff validation — Sr. nos. 119-130 of the June 2025 appendix
-- are confirmed rescinded. The diff engine must classify these as "repealed".
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS appendix_circulars (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    circular_id     UUID NOT NULL REFERENCES circulars(id) ON DELETE CASCADE,
    sr_no           INT NOT NULL,        -- serial number in the appendix table
    ref_circular_number TEXT NOT NULL,   -- the superseded circular's reference number
    subject         TEXT,                -- subject of the superseded circular
    issued_date     DATE,                -- date of the superseded circular
    rescinded       BOOLEAN NOT NULL DEFAULT false, -- true for sr_no 119-130 in 2025 version
    parsed_from     TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ac_circular_idx ON appendix_circulars (circular_id);
CREATE UNIQUE INDEX IF NOT EXISTS ac_srno_circular_idx
    ON appendix_circulars (circular_id, sr_no);

-- ─────────────────────────────────────────────────────────────────────────────
-- Add unique constraint on (circular_id, clause_ref) so ingestion is idempotent.
-- The base schema has no such constraint; idempotency in chunk.ts currently uses
-- a DELETE-before-INSERT pattern, but this index prevents accidental duplicates
-- if multiple runs overlap.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS clauses_circular_ref_idx
    ON clauses (circular_id, clause_ref);
