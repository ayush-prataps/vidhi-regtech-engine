import { NextResponse } from "next/server";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const DEMO_ORG_ID = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { obligation_id, description, file_url } = body;

    if (!obligation_id || !description || !description.trim()) {
      return NextResponse.json(
        { error: "obligation_id and description are required fields." },
        { status: 400 }
      );
    }

    // Verify obligation exists
    const obCheck = await pool.query(
      `SELECT o.id, c.clause_ref, o.obligation_summary 
       FROM obligations o 
       JOIN clauses c ON c.id = o.clause_id 
       WHERE o.id = $1`,
      [obligation_id]
    );
    if (obCheck.rows.length === 0) {
      return NextResponse.json({ error: "Obligation not found." }, { status: 404 });
    }
    const ob = obCheck.rows[0];

    const { rows } = await pool.query(
      `INSERT INTO evidence (obligation_id, org_id, description, file_url, review_status)
       VALUES ($1, $2, $3, $4, 'accepted')
       RETURNING *`,
      [
        obligation_id,
        DEMO_ORG_ID,
        description.trim(),
        file_url ? file_url.trim() : null,
      ]
    );

    const insertedEvidence = rows[0];

    // Task 2: Insert into append-only audit_log
    try {
      await pool.query(
        `INSERT INTO audit_log (entity_type, entity_id, action, actor, details)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          "evidence",
          insertedEvidence.id,
          "evidence_attached",
          "Compliance Officer",
          JSON.stringify({
            obligation_id,
            clause_ref: ob.clause_ref,
            summary: ob.obligation_summary,
            evidence_description: description.trim(),
            file_url: file_url ? file_url.trim() : null,
          }),
        ]
      );
    } catch (auditErr) {
      console.error("[audit_log insert error - non-blocking]", auditErr);
    }

    return NextResponse.json({ evidence: insertedEvidence }, { status: 201 });
  } catch (err) {
    console.error("[api/evidence POST]", err);
    return NextResponse.json(
      { error: "Failed to submit evidence." },
      { status: 500 }
    );
  }
}
