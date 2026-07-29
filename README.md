# Vidhi — Agentic Compliance Engine

Vidhi turns unstructured SEBI regulatory text (master circulars, notifications) into a
structured, versioned, machine-actionable obligation graph — with every obligation
grounded to its exact source clause. On top of that sits a compliance tracker that maps
obligations to intermediary evidence and flags gaps before an inspection does.

**Status: scaffold.** Nothing in here is production-tested yet. This is the skeleton — schema, folder structure, stub extraction/ingestion logic — not a working product.

## Why it's structured this way

Two problems, two pipelines, one shared store:

1. **Regulatory translation** (`packages/ingestion` + `packages/extraction`) — turns a
   circular PDF into clause-level chunks, then into obligation records via LLM extraction
   that is *grounded*, not generative. The model extracts and cites; it never invents an
   obligation that isn't backed by an exact source paragraph.
2. **Compliance tracking** (`apps/web`) — the intermediary-facing surface where obligations
   get mapped to evidence, gaps get flagged, and audit trails get exported.

`packages/diff-engine` sits between the two: whenever a new circular version comes in, it
diffs obligations against the prior version and flags what changed.

## Repo layout

```
vidhi-regtech-engine/
# copy the same values into apps/web/.env.local for Next.js
# fill in DATABASE_URL and GROQ_API_KEY once
├── packages/ingestion/     PDF -> clause-chunked text
├── packages/extraction/    Chunked text -> grounded obligation records (Groq/Llama)
├── packages/diff-engine/   Obligation version diffing
├── db/                     Postgres + pgvector schema, migrations
├── docs/                   Architecture notes
└── scripts/                Local setup helpers
```

Next.js reads `apps/web/.env.local` automatically, so the web app uses standard Next env loading.

Prereqs: Node 20+, a local Postgres instance, and a Groq API key.

Development uses local Postgres. Use Neon when you move to deployment.

```bash
cp .env.example .env
# fill in DATABASE_URL and GROQ_API_KEY

psql "$DATABASE_URL" -f db/schema.sql

cd apps/web && npm install && npm run dev
```

Ingest a circular (once you've actually written the PDF parsing logic — see the TODOs):

```bash
cd packages/ingestion && npm run chunk -- --file path/to/circular.pdf
cd packages/extraction && npm run extract -- --circular-id <id>
```

## What's actually implemented vs. stubbed

| Piece | Status |
|---|---|
| DB schema (circulars, obligations, evidence, obligation_versions) | Written, not yet migrated/tested |
| Clause chunking | Stub — regex placeholder, needs testing against real SEBI PDF numbering |
| Obligation extraction prompt + Groq call | Stub — prompt drafted, untested against real corpus |
| Diff engine | Stub — comparison logic sketched, no real diff algorithm yet |
| Compliance tracker UI | Not started — one placeholder API route |
| Auth | Not started |

Start with the SEBI stockbroker master circular (the corpus SEBI itself suggests) and get
the ingestion → extraction path working end to end on that one document before touching
anything else. Everything else is easy to add once that path is real.

## Stack

Groq (Llama 3.3 70B) · Postgres + pgvector · Redis Streams · Next.js · sentence-transformers

## Origin

This idea is originally proposed for the **SEBI Securities Market TechSprint at Global Fintech Fest 2026**, under the **Agentic Compliance From Regulatory Text to Operational Action** problem statement.

## Author

Ayush Pratap Singh, B.Tech CSE, BML Munjal University.