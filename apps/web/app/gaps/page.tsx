"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

interface GappedObligation {
  id: string;
  clause_ref: string;
  obligation_summary: string;
  action_required: string;
  intermediary_category: string;
  frequency: string | null;
  deadline_rule: string | null;
  evidence_type: string | null;
  status: string;
  evidence_count: number;
}

export default function GapAlertsPage() {
  const [gaps, setGaps] = useState<GappedObligation[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeModalId, setActiveModalId] = useState<string | null>(null);

  // Quick evidence form state
  const [quickDesc, setQuickDesc] = useState("");
  const [quickUrl, setQuickUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const fetchGaps = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/obligations?gap=gapped&status=active");
      const data = await res.json();
      if (data.obligations) {
        setGaps(data.obligations);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchGaps();
  }, []);

  const handleQuickSubmit = async (e: React.FormEvent, obligationId: string) => {
    e.preventDefault();
    if (!quickDesc.trim() || submitting) return;

    setSubmitting(true);
    try {
      const res = await fetch("/api/evidence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          obligation_id: obligationId,
          description: quickDesc.trim(),
          file_url: quickUrl.trim() || null,
        }),
      });

      if (res.ok) {
        // Remove obligation from gap alert list immediately (T4.3 requirement)
        setGaps(gaps.filter((g) => g.id !== obligationId));
        setActiveModalId(null);
        setQuickDesc("");
        setQuickUrl("");
      }
    } catch (err) {
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.35rem" }}>
          <h1 className="page-title" style={{ margin: 0 }}>Compliance Gap Alerts</h1>
          <span className="badge badge-gap" style={{ fontSize: "0.9rem", padding: "0.3rem 0.6rem" }}>
            {gaps.length} Unmapped Gaps
          </span>
        </div>
        <p className="page-subtitle">
          High-priority compliance gaps: Active SEBI master circular obligations with zero attached evidence records.
        </p>
      </div>

      {/* Alert Header Banner */}
      <div
        className="glass-card"
        style={{
          borderLeft: "4px solid var(--rose)",
          background: "rgba(244, 63, 94, 0.08)",
          marginBottom: "1.75rem",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <span style={{ fontSize: "1.5rem" }}>⚠️</span>
          <div>
            <div style={{ fontWeight: 600, color: "var(--text-primary)", fontSize: "1rem" }}>
              Inspection Audit Exposure Notice
            </div>
            <div style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>
              The {gaps.length} obligations below require documented evidence. Attach proof below to resolve each gap alert in real time.
            </div>
          </div>
        </div>
      </div>

      {loading ? (
        <div style={{ padding: "3rem", textAlign: "center", color: "var(--text-muted)" }}>
          Scanning for unmapped compliance gaps...
        </div>
      ) : gaps.length === 0 ? (
        <div className="glass-card" style={{ textAlign: "center", padding: "3rem" }}>
          <span style={{ fontSize: "2.5rem" }}>🎉</span>
          <h2 style={{ fontSize: "1.35rem", marginTop: "0.75rem", color: "var(--emerald)" }}>
            Zero Compliance Gaps Detected!
          </h2>
          <p style={{ color: "var(--text-muted)", fontSize: "0.9rem", marginTop: "0.35rem" }}>
            All active obligations have attached operational evidence.
          </p>
          <Link href="/" className="btn btn-primary" style={{ marginTop: "1.25rem" }}>
            View Obligations Graph
          </Link>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          {gaps.map((ob) => (
            <div key={ob.id} className="glass-card" style={{ borderLeft: "3px solid var(--rose)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "1rem", flexWrap: "wrap" }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginBottom: "0.4rem" }}>
                    <span className="badge badge-clause">Clause {ob.clause_ref}</span>
                    <span className="badge badge-gap">Gapped</span>
                    <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", textTransform: "capitalize" }}>
                      Category: {ob.intermediary_category}
                    </span>
                  </div>

                  <h3 style={{ fontSize: "1.05rem", color: "var(--text-primary)", marginBottom: "0.35rem" }}>
                    {ob.obligation_summary}
                  </h3>

                  <p style={{ fontSize: "0.85rem", color: "var(--text-secondary)", marginBottom: "0.6rem" }}>
                    {ob.action_required}
                  </p>

                  {ob.evidence_type && (
                    <div style={{ fontSize: "0.785rem", color: "var(--text-muted)" }}>
                      <strong>Suggested Evidence:</strong> {ob.evidence_type}
                    </div>
                  )}
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", alignItems: "flex-end" }}>
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={() => {
                      setActiveModalId(activeModalId === ob.id ? null : ob.id);
                      setQuickDesc("");
                      setQuickUrl("");
                    }}
                    id={`quick-attach-btn-${ob.id}`}
                  >
                    {activeModalId === ob.id ? "Cancel Attachment" : "⚡ Attach Evidence"}
                  </button>

                  <Link href={`/obligations/${ob.id}`} className="btn btn-outline btn-sm">
                    View Full Details →
                  </Link>
                </div>
              </div>

              {/* Inline Quick Attachment Form */}
              {activeModalId === ob.id && (
                <div
                  style={{
                    marginTop: "1rem",
                    paddingTop: "1rem",
                    borderTop: "1px solid var(--border-color)",
                    background: "#0F172A",
                    padding: "1rem",
                    borderRadius: "var(--radius-sm)",
                  }}
                >
                  <div style={{ fontWeight: 600, fontSize: "0.85rem", color: "var(--primary)", marginBottom: "0.5rem" }}>
                    Remediate Gap for Clause {ob.clause_ref}
                  </div>

                  <form onSubmit={(e) => handleQuickSubmit(e, ob.id)}>
                    <div className="form-group">
                      <label className="form-label" htmlFor={`quick-desc-${ob.id}`}>Evidence Description / Operational Proof *</label>
                      <input
                        type="text"
                        id={`quick-desc-${ob.id}`}
                        className="form-control"
                        placeholder="e.g. Monthly UCC particulars return filed with exchange on July 5, 2025."
                        value={quickDesc}
                        onChange={(e) => setQuickDesc(e.target.value)}
                        required
                      />
                    </div>

                    <div className="form-group">
                      <label className="form-label" htmlFor={`quick-url-${ob.id}`}>Document Reference URL / File Path (Optional)</label>
                      <input
                        type="text"
                        id={`quick-url-${ob.id}`}
                        className="form-control"
                        placeholder="e.g. https://internal.broker.com/audits/2025/ucc_log.pdf"
                        value={quickUrl}
                        onChange={(e) => setQuickUrl(e.target.value)}
                      />
                    </div>

                    <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => setActiveModalId(null)}
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        className="btn btn-primary btn-sm"
                        disabled={submitting || !quickDesc.trim()}
                        id={`submit-quick-evidence-${ob.id}`}
                      >
                        {submitting ? "Saving..." : "Save Evidence & Clear Gap"}
                      </button>
                    </div>
                  </form>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
