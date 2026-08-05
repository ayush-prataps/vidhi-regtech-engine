"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

interface AuditLogItem {
  id: string;
  entity_type: string;
  entity_id: string;
  action: string;
  actor: string;
  details: any;
  created_at: string;
}

export default function AuditTrailPage() {
  const [logs, setLogs] = useState<AuditLogItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchAudit() {
      try {
        const res = await fetch("/api/audit");
        const data = await res.json();
        if (data.audit_logs) {
          setLogs(data.audit_logs);
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    fetchAudit();
  }, []);

  return (
    <div>
      <div className="page-header">
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.35rem" }}>
          <h1 className="page-title" style={{ margin: 0 }}>Compliance Audit Trail</h1>
          <span className="badge badge-active" style={{ fontSize: "0.85rem" }}>
            {logs.length} Immutable Events
          </span>
        </div>
        <p className="page-subtitle">
          Append-only compliance activity log tracking evidence attachment and human-in-the-loop review status changes.
        </p>
      </div>

      <div className="table-container">
        <table className="data-table">
          <thead>
            <tr>
              <th>Timestamp</th>
              <th>Action</th>
              <th>Entity Type</th>
              <th>Actor</th>
              <th>Summary Details</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} style={{ textAlign: "center", padding: "2rem", color: "var(--text-muted)" }}>
                  Loading compliance audit logs...
                </td>
              </tr>
            ) : logs.length === 0 ? (
              <tr>
                <td colSpan={5} style={{ textAlign: "center", padding: "2rem", color: "var(--text-muted)" }}>
                  No audit log entries recorded yet. Attach evidence or change an obligation review status to record an event.
                </td>
              </tr>
            ) : (
              logs.map((item) => (
                <tr key={item.id}>
                  <td style={{ whiteSpace: "nowrap", fontSize: "0.8rem" }}>
                    {new Date(item.created_at).toLocaleString()}
                  </td>
                  <td>
                    {item.action === "evidence_attached" && (
                      <span className="badge badge-active">Evidence Attached</span>
                    )}
                    {item.action === "status_changed" && (
                      <span className="badge badge-amended">Status Changed</span>
                    )}
                  </td>
                  <td>
                    <span className="badge badge-clause" style={{ textTransform: "capitalize" }}>
                      {item.entity_type}
                    </span>
                  </td>
                  <td>
                    <span style={{ fontSize: "0.85rem", fontWeight: 500 }}>{item.actor}</span>
                  </td>
                  <td>
                    {item.action === "evidence_attached" && (
                      <div>
                        <div style={{ fontWeight: 600, color: "var(--text-primary)" }}>
                          Clause {item.details?.clause_ref}: {item.details?.summary}
                        </div>
                        <div style={{ fontSize: "0.8rem", color: "var(--text-secondary)", marginTop: "0.2rem" }}>
                          📎 {item.details?.evidence_description}
                        </div>
                      </div>
                    )}

                    {item.action === "status_changed" && (
                      <div>
                        <div style={{ fontWeight: 600, color: "var(--text-primary)" }}>
                          Clause {item.details?.clause_ref}: {item.details?.summary}
                        </div>
                        <div style={{ fontSize: "0.8rem", color: "var(--amber)", marginTop: "0.2rem" }}>
                          Status changed from &ldquo;{item.details?.old_status}&rdquo; → &ldquo;{item.details?.new_status}&rdquo;
                        </div>
                      </div>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
