# Circular IDs — generated during Phase 1 ingestion

> **Note**: These UUIDs are local to the machine/cloud database where ingestion was run.
> On a fresh database, run `npm run seed` or `chunk.ts` to populate them.

## 2025 circular (June 17, 2025)
- **Circular number**: `SEBI/HO/MIRSD/MIRSD-PoD/P/CIR/2025/90`
- **DB circular_id**: `b71494b8-4007-44d5-a178-79e1263367fc`
- **Clauses ingested**: 69 clauses (System Audit section 17, UCC section 20, Trading Account Opening section 21, GIFT-IFSC section 71, NDS-OM section 72, Reporting Requirements)

## 2024 circular (August 9, 2024)
- **Circular number**: `SEBI/HO/MIRSD/MIRSD-PoD-1/P/CIR/2024/110`
- **DB circular_id**: `ea3e508d-e65d-4297-897c-73c9d5eed48b`
- **Clauses ingested**: 42 clauses (UCC section 19/20 + Trading Account Opening section 20/21)

## Usage in subsequent scripts
```bash
export CIRCULAR_2025=b71494b8-4007-44d5-a178-79e1263367fc
export CIRCULAR_2024=ea3e508d-e65d-4297-897c-73c9d5eed48b
export DATABASE_URL=postgresql://neondb_owner:...@ep-crimson-dream-az48i64w-pooler.c-3.ap-southeast-1.aws.neon.tech/neondb?sslmode=require
```
