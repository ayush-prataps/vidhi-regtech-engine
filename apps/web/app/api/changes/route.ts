import { NextResponse } from "next/server";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export async function GET() {
  try {
    const query = `
      SELECT 
        ov.id,
        ov.obligation_id,
        ov.previous_obligation_id,
        ov.change_type,
        ov.diff_summary,
        ov.detected_at,
        c_new.clause_ref AS new_clause_ref,
        o_new.obligation_summary AS new_summary,
        c_old.clause_ref AS old_clause_ref,
        o_old.obligation_summary AS old_summary
      FROM obligation_versions ov
      LEFT JOIN obligations o_new ON o_new.id = ov.obligation_id
      LEFT JOIN clauses c_new ON c_new.id = o_new.clause_id
      LEFT JOIN obligations o_old ON o_old.id = ov.previous_obligation_id
      LEFT JOIN clauses c_old ON c_old.id = o_old.clause_id
      ORDER BY 
        CASE ov.change_type
          WHEN 'repealed' THEN 1
          WHEN 'new' THEN 2
          WHEN 'amended' THEN 3
          ELSE 4
        END,
        c_new.clause_ref ASC NULLS LAST
    `;

    const { rows } = await pool.query(query);

    const counts = {
      total: rows.length,
      new: rows.filter((r) => r.change_type === "new").length,
      amended: rows.filter((r) => r.change_type === "amended").length,
      repealed: rows.filter((r) => r.change_type === "repealed").length,
    };

    return NextResponse.json({ changes: rows, stats: counts });
  } catch (err) {
    console.error("[api/changes GET]", err);
    return NextResponse.json(
      { error: "Failed to fetch regulatory version changes." },
      { status: 500 }
    );
  }
}
