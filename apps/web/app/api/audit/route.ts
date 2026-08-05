import { NextResponse } from "next/server";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export async function GET() {
  try {
    const query = `
      SELECT id, entity_type, entity_id, action, actor, details, created_at
      FROM audit_log
      ORDER BY created_at DESC
      LIMIT 100
    `;

    const { rows } = await pool.query(query);

    return NextResponse.json({ audit_logs: rows });
  } catch (err) {
    console.error("[api/audit GET]", err);
    return NextResponse.json(
      { error: "Failed to fetch audit log." },
      { status: 500 }
    );
  }
}
