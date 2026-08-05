import { NextResponse } from "next/server";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const obQuery = `
      SELECT 
        o.*,
        c.clause_ref,
        c.text AS clause_text,
        cir.title AS circular_title,
        cir.circular_number,
        cir.issued_date AS circular_date
      FROM obligations o
      JOIN clauses c ON c.id = o.clause_id
      JOIN circulars cir ON cir.id = o.circular_id
      WHERE o.id = $1
    `;
    const obRes = await pool.query(obQuery, [id]);

    if (obRes.rows.length === 0) {
      return NextResponse.json({ error: "Obligation not found" }, { status: 404 });
    }

    const obligation = obRes.rows[0];

    // Fetch evidence items for this obligation
    const evQuery = `
      SELECT id, obligation_id, org_id, description, file_url, submitted_at, reviewed_by, review_status
      FROM evidence
      WHERE obligation_id = $1
      ORDER BY submitted_at DESC
    `;
    const evRes = await pool.query(evQuery, [id]);

    // Fetch version diff history if any
    const diffQuery = `
      SELECT ov.id, ov.change_type, ov.diff_summary, ov.detected_at
      FROM obligation_versions ov
      WHERE ov.obligation_id = $1 OR ov.previous_obligation_id = $1
      ORDER BY ov.detected_at DESC
    `;
    const diffRes = await pool.query(diffQuery, [id]);

    return NextResponse.json({
      obligation,
      evidence: evRes.rows,
      diff_history: diffRes.rows,
    });
  } catch (err) {
    console.error("[api/obligations/[id] GET]", err);
    return NextResponse.json(
      { error: "Failed to fetch obligation detail." },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const body = await request.json();
    const { status } = body;

    const allowedStatuses = ["active", "needs_review", "repealed", "superseded"];
    if (!status || !allowedStatuses.includes(status)) {
      return NextResponse.json(
        { error: `Invalid status. Must be one of: ${allowedStatuses.join(", ")}` },
        { status: 400 }
      );
    }

    // Fetch old status & details before update for audit log
    const oldRes = await pool.query(
      `SELECT o.status, c.clause_ref, o.obligation_summary 
       FROM obligations o 
       JOIN clauses c ON c.id = o.clause_id 
       WHERE o.id = $1`,
      [id]
    );

    const oldRow = oldRes.rows[0];

    const { rows } = await pool.query(
      `UPDATE obligations 
       SET status = $1 
       WHERE id = $2 
       RETURNING *`,
      [status, id]
    );

    if (rows.length === 0) {
      return NextResponse.json({ error: "Obligation not found" }, { status: 404 });
    }

    const updatedObligation = rows[0];

    // Task 2: Insert into append-only audit_log
    try {
      await pool.query(
        `INSERT INTO audit_log (entity_type, entity_id, action, actor, details)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          "obligation",
          id,
          "status_changed",
          "Compliance Officer",
          JSON.stringify({
            clause_ref: oldRow?.clause_ref || "",
            summary: oldRow?.obligation_summary || "",
            old_status: oldRow?.status || "active",
            new_status: status,
          }),
        ]
      );
    } catch (auditErr) {
      console.error("[audit_log insert error - non-blocking]", auditErr);
    }

    return NextResponse.json({ obligation: updatedObligation });
  } catch (err) {
    console.error("[api/obligations/[id] PATCH]", err);
    return NextResponse.json(
      { error: "Failed to update obligation status." },
      { status: 500 }
    );
  }
}
