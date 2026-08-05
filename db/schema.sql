-- Vidhi core schema
-- Run: psql "$DATABASE_URL" -f db/schema.sql

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- A specific version of a SEBI circular/master circular as ingested.
CREATE TABLE IF NOT EXISTS circulars (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title           TEXT NOT NULL,
    circular_number TEXT NOT NULL,
    issued_date     DATE,
    source_url      TEXT,
    intermediary_category TEXT NOT NULL, -- e.g. 'stockbroker', 'investment_adviser', 'rta', 'amc'
    version         INT NOT NULL DEFAULT 1,
    supersedes_id   UUID REFERENCES circulars(id),
    raw_text        TEXT NOT NULL,
    ingested_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Clause-level chunks preserving paragraph numbering for citation.
CREATE TABLE IF NOT EXISTS clauses (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    circular_id     UUID NOT NULL REFERENCES circulars(id) ON DELETE CASCADE,
    clause_ref      TEXT NOT NULL,   -- e.g. '4.2.1', matches the circular's own numbering
    text            TEXT NOT NULL,
    embedding       vector(384),     -- sentence-transformers all-MiniLM-L6-v2 dim
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS clauses_embedding_idx
    ON clauses USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- Extracted obligations. Every row must trace back to a clause_id — no ungrounded rows.
CREATE TABLE IF NOT EXISTS obligations (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    circular_id         UUID NOT NULL REFERENCES circulars(id) ON DELETE CASCADE,
    clause_id           UUID NOT NULL REFERENCES clauses(id) ON DELETE CASCADE,
    intermediary_category TEXT NOT NULL,
    obligation_summary  TEXT NOT NULL,     -- short human-readable statement
    action_required     TEXT NOT NULL,
    frequency           TEXT,              -- e.g. 'one-time', 'quarterly', 'on-event'
    deadline_rule       TEXT,              -- free text or cron-like rule, kept simple for v1
    evidence_type       TEXT,              -- what kind of evidence satisfies this obligation
    status              TEXT NOT NULL DEFAULT 'active', -- active | superseded | repealed
    extracted_by_model  TEXT,
    extraction_confidence NUMERIC(3,2),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Version history when an obligation changes due to a circular amendment.
CREATE TABLE IF NOT EXISTS obligation_versions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    obligation_id   UUID NOT NULL REFERENCES obligations(id) ON DELETE CASCADE,
    previous_obligation_id UUID REFERENCES obligations(id),
    change_type     TEXT NOT NULL, -- 'new' | 'amended' | 'repealed'
    diff_summary    TEXT,
    detected_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Intermediary-submitted evidence mapped against an obligation.
CREATE TABLE IF NOT EXISTS evidence (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    obligation_id   UUID NOT NULL REFERENCES obligations(id) ON DELETE CASCADE,
    org_id          UUID NOT NULL,
    description     TEXT NOT NULL,
    file_url        TEXT,
    submitted_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    reviewed_by     TEXT,
    review_status   TEXT NOT NULL DEFAULT 'pending' -- pending | accepted | rejected
);

-- Minimal org table so evidence has something to point at. Expand later (auth, roles).
CREATE TABLE IF NOT EXISTS organizations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL,
    intermediary_category TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Append-only audit trail for compliance events (evidence attachment, status changes).
CREATE TABLE IF NOT EXISTS audit_log (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type     TEXT NOT NULL, -- 'obligation' | 'evidence'
    entity_id       UUID NOT NULL,
    action          TEXT NOT NULL, -- 'evidence_attached' | 'status_changed'
    actor           TEXT NOT NULL DEFAULT 'Compliance Officer',
    details         JSONB NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_log_created_at_idx ON audit_log (created_at DESC);

