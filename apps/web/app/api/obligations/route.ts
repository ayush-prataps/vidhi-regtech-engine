import { NextResponse } from "next/server";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const category = searchParams.get("category");
  const status = searchParams.get("status");
  const gap = searchParams.get("gap"); // 'gapped' | 'compliant'
  const search = searchParams.get("search");

  try {
    const conditions: string[] = [];
    const params: any[] = [];

    if (category && category !== "all") {
      params.push(category);
      conditions.push(`o.intermediary_category = $${params.length}`);
    }

    if (status && status !== "all") {
      params.push(status);
      conditions.push(`o.status = $${params.length}`);
    }

    if (search && search.trim()) {
      params.push(`%${search.trim()}%`);
      const idx = params.length;
      conditions.push(
        `(o.obligation_summary ILIKE $${idx} OR o.action_required ILIKE $${idx} OR c.clause_ref ILIKE $${idx})`
      );
    }

    let whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    let havingClause = "";
    if (gap === "gapped") {
      havingClause = "HAVING COUNT(e.id) = 0";
    } else if (gap === "compliant") {
      havingClause = "HAVING COUNT(e.id) > 0";
    }

    const query = `
      SELECT 
        o.id,
        o.circular_id,
        o.clause_id,
        o.intermediary_category,
        o.obligation_summary,
        o.action_required,
        o.frequency,
        o.deadline_rule,
        o.evidence_type,
        o.status,
        o.extracted_by_model,
        o.extraction_confidence,
        o.created_at,
        c.clause_ref,
        c.text AS clause_text,
        cir.title AS circular_title,
        cir.circular_number,
        COUNT(e.id)::int AS evidence_count
      FROM obligations o
      JOIN clauses c ON c.id = o.clause_id
      JOIN circulars cir ON cir.id = o.circular_id
      LEFT JOIN evidence e ON e.obligation_id = o.id
      ${whereClause}
      GROUP BY o.id, c.id, cir.id
      ${havingClause}
      ORDER BY 
        CASE 
          WHEN o.status = 'needs_review' THEN 1
          WHEN o.status = 'active' THEN 2
          ELSE 3
        END,
        c.clause_ref ASC
    `;

    const { rows } = await pool.query(query, params);

    // Compute summary stats
    const statsQuery = `
      SELECT 
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE status = 'active')::int AS active,
        COUNT(*) FILTER (WHERE status = 'needs_review')::int AS needs_review,
        (
          SELECT COUNT(*)::int 
          FROM obligations ob 
          LEFT JOIN evidence ev ON ev.obligation_id = ob.id 
          WHERE ev.id IS NULL AND ob.status = 'active'
        ) AS total_gaps
      FROM obligations
    `;
    const statsRes = await pool.query(statsQuery);
    const stats = statsRes.rows[0];

    return NextResponse.json({ 
      obligations: rows,
      stats: {
        total: stats.total,
        active: stats.active,
        needs_review: stats.needs_review,
        total_gaps: stats.total_gaps,
      }
    });
  } catch (err) {
    console.error("[api/obligations]", err);
    return NextResponse.json(
      { error: "Failed to fetch obligations. Check DB connection." },
      { status: 500 }
    );
  }
}
