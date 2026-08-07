"use client";

import { useState, useEffect, use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

interface ObligationDetail {
  id: string;
  clause_ref: string;
  clause_text: string;
  obligation_summary: string;
  action_required: string;
  intermediary_category: string;
  frequency: string | null;
  deadline_rule: string | null;
  evidence_type: string | null;
  status: string;
  extraction_confidence: number;
  extracted_by_model: string;
  circular_title: string;
  circular_number: string;
}

interface EvidenceItem {
  id: string;
  description: string;
  file_url: string | null;
  submitted_at: string;
  review_status: string;
}

export default function ObligationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();

  const [obligation, setObligation] = useState<ObligationDetail | null>(null);
  const [evidenceList, setEvidenceList] = useState<EvidenceItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Evidence Form State
  const [evidenceDesc, setEvidenceDesc] = useState("");
  const [evidenceUrl, setEvidenceUrl] = useState("");
  const [submittingEvidence, setSubmittingEvidence] = useState(false);
  const [evidenceSuccessMsg, setEvidenceSuccessMsg] = useState("");

  // Status Switcher State
  const [updatingStatus, setUpdatingStatus] = useState(false);

  const fetchDetail = async () => {
    try {
      const res = await fetch(`/api/obligations/${id}`);
      if (!res.ok) throw new Error("Failed to fetch detail");
      const data = await res.json();
      setObligation(data.obligation);
      setEvidenceList(data.evidence || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDetail();
  }, [id]);

  const handleStatusChange = async (newStatus: string) => {
    if (!obligation || updatingStatus) return;
    setUpdatingStatus(true);
    try {
      const res = await fetch(`/api/obligations/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (res.ok) {
        setObligation({ ...obligation, status: newStatus });
      }
    } catch (err) {
      console.error(err);
    } finally {
      setUpdatingStatus(false);
    }
  };

  const handleEvidenceSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!evidenceDesc.trim() || submittingEvidence) return;

    setSubmittingEvidence(true);
    setEvidenceSuccessMsg("");

    try {
      const res = await fetch("/api/evidence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          obligation_id: id,
          description: evidenceDesc.trim(),
          file_url: evidenceUrl.trim() || null,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setEvidenceList([data.evidence, ...evidenceList]);
        setEvidenceDesc("");
        setEvidenceUrl("");
        setEvidenceSuccessMsg("Evidence submitted successfully! Gap cleared.");
        setTimeout(() => setEvidenceSuccessMsg(""), 4000);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setSubmittingEvidence(false);
    }
  };

  if (loading) {
    return <div style={{ padding: "3rem", textAlign: "center", color: "var(--text-muted)" }}>Loading obligation detail...</div>;
  }

  if (!obligation) {
    return (
      <div style={{ padding: "3rem", textAlign: "center" }}>
        <h2>Obligation Not Found</h2>
        <Link href="/" className="btn btn-primary" style={{ marginTop: "1rem" }}>
          Back to Obligations
        </Link>
      </div>
    );
  }

  return (
    <div>
      <div style={{ marginBottom: "1.25rem" }}>
        <Link href="/" className="btn btn-secondary btn-sm" id="back-to-list-btn">
          ← Back to Obligations Table
        </Link>
      </div>

      {/* Title & Status */}
      <div className="glass-card" style={{ marginBottom: "1.5rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "1rem", flexWrap: "wrap" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.5rem" }}>
              <span className="badge badge-clause" style={{ fontSize: "1rem", padding: "0.35rem 0.65rem" }}>
                Clause {obligation.clause_ref}
              </span>
              <span style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>
                {obligation.circular_number}
              </span>
            </div>
            <h1 style={{ fontSize: "1.35rem", color: "var(--text-primary)", marginBottom: "0.5rem" }}>
              {obligation.obligation_summary}
            </h1>
          </div>

          {/* Status Badge & Interactive Switcher (T4.4) */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "0.5rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>Status:</span>
              {obligation.status === "active" && <span className="badge badge-active">Active</span>}
              {obligation.status === "needs_review" && <span className="badge badge-review">Needs Review</span>}
              {obligation.status === "repealed" && <span className="badge badge-repealed">Repealed</span>}
            </div>

            {/* Toggle Buttons */}
            <div style={{ display: "flex", gap: "0.35rem" }}>
              <button
                className={`btn btn-sm ${obligation.status === "active" ? "btn-primary" : "btn-secondary"}`}
                onClick={() => handleStatusChange("active")}
                disabled={updatingStatus}
                id="set-active-status-btn"
              >
                Mark Active
              </button>
              <button
                className={`btn btn-sm ${obligation.status === "needs_review" ? "btn-primary" : "btn-secondary"}`}
                onClick={() => handleStatusChange("needs_review")}
                disabled={updatingStatus}
                id="set-needs-review-status-btn"
                style={obligation.status === "needs_review" ? { background: "var(--amber)", borderColor: "var(--amber)", color: "#000" } : {}}
              >
                Flag Needs Review
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Grounding Source Box */}
      <div className="grounding-box">
        <div className="grounding-label">SOURCE CLAUSE (VERBATIM)</div>
        <p className="grounding-text">
          &ldquo;{obligation.clause_text}&rdquo;
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "1.5rem" }}>
        {/* Left Column: Metadata Details */}
        <div className="glass-card">
          <h3 style={{ fontSize: "1.1rem", marginBottom: "1rem", borderBottom: "1px solid var(--border-color)", paddingBottom: "0.5rem" }}>
            Obligation Metadata
          </h3>

          <div className="form-group">
            <span className="form-label">Action Required (Full Details):</span>
            <div style={{ color: "var(--text-primary)", fontSize: "0.9rem", background: "#0F172A", padding: "0.75rem", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-color)" }}>
              {obligation.action_required}
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
            <div className="form-group">
              <span className="form-label">Category:</span>
              <span style={{ fontSize: "0.85rem", color: "var(--text-secondary)", textTransform: "capitalize" }}>
                {obligation.intermediary_category}
              </span>
            </div>
            <div className="form-group">
              <span className="form-label">Frequency:</span>
              <span style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>
                {obligation.frequency || "Not specified"}
              </span>
            </div>
          </div>

          <div className="form-group">
            <span className="form-label">Deadline Rule:</span>
            <span style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>
              {obligation.deadline_rule || "None specified in clause"}
            </span>
          </div>

          <div className="form-group">
            <span className="form-label">Suggested Evidence Type:</span>
            <span style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>
              {obligation.evidence_type || "Standard compliance log / register entry"}
            </span>
          </div>

          <div className="form-group">
            <span className="form-label">Extraction Model & Confidence:</span>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <span className="badge badge-clause">{obligation.extracted_by_model || "llama-3.1-8b-instant"}</span>
              <span className="badge badge-active">{Math.round((obligation.extraction_confidence || 0.95) * 100)}% confidence</span>
            </div>
          </div>
        </div>

        {/* Right Column: Evidence Mapping Form & History (T4.2) */}
        <div>
          {/* Submit Evidence Form */}
          <div className="glass-card" style={{ marginBottom: "1.5rem" }}>
            <h3 style={{ fontSize: "1.1rem", marginBottom: "0.5rem" }}>
              Submit Compliance Evidence (T4.2)
            </h3>
            <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginBottom: "1rem" }}>
              Link operational records, audit logs, or statements to map compliance against this grounded obligation.
            </p>

            {evidenceSuccessMsg && (
              <div style={{ background: "var(--emerald-light)", color: "var(--emerald)", padding: "0.65rem 0.85rem", borderRadius: "var(--radius-sm)", border: "1px solid rgba(16, 185, 129, 0.3)", fontSize: "0.85rem", marginBottom: "1rem" }}>
                ✓ {evidenceSuccessMsg}
              </div>
            )}

            <form onSubmit={handleEvidenceSubmit}>
              <div className="form-group">
                <label className="form-label" htmlFor="evidence-desc-input">Evidence Description / Proof Record *</label>
                <textarea
                  id="evidence-desc-input"
                  className="form-control"
                  placeholder="e.g. Monthly UCC client particulars submission log for July 2025, verified by Compliance Officer."
                  value={evidenceDesc}
                  onChange={(e) => setEvidenceDesc(e.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="evidence-url-input">Reference Document Link / File Path (Optional)</label>
                <input
                  type="text"
                  id="evidence-url-input"
                  className="form-control"
                  placeholder="e.g. s3://compliance-docs/2025/07/ucc_monthly_return.pdf"
                  value={evidenceUrl}
                  onChange={(e) => setEvidenceUrl(e.target.value)}
                />
              </div>

              <button
                type="submit"
                className="btn btn-primary"
                style={{ width: "100%" }}
                disabled={submittingEvidence || !evidenceDesc.trim()}
                id="submit-evidence-btn"
              >
                {submittingEvidence ? "Linking Evidence..." : "Attach Compliance Evidence"}
              </button>
            </form>
          </div>

          {/* Linked Evidence History */}
          <div className="glass-card">
            <h3 style={{ fontSize: "1.1rem", marginBottom: "0.85rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span>Linked Evidence Records</span>
              <span className="badge badge-count">{evidenceList.length}</span>
            </h3>

            {evidenceList.length === 0 ? (
              <div style={{ textAlign: "center", padding: "1.5rem", background: "#0F172A", borderRadius: "var(--radius-sm)", border: "1px dashed var(--rose)", color: "var(--rose)" }}>
                <div style={{ fontWeight: 600, marginBottom: "0.25rem" }}>⚠️ Compliance Gap Detected</div>
                <div style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
                  No evidence has been attached to this active obligation yet.
                </div>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                {evidenceList.map((ev) => (
                  <div key={ev.id} style={{ background: "#0F172A", padding: "0.85rem", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-color)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.35rem" }}>
                      <span className="badge badge-active" style={{ fontSize: "0.7rem" }}>Status: {ev.review_status}</span>
                      <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                        {new Date(ev.submitted_at).toLocaleDateString()}
                      </span>
                    </div>
                    <div style={{ fontSize: "0.875rem", color: "var(--text-primary)", marginBottom: "0.25rem" }}>
                      {ev.description}
                    </div>
                    {ev.file_url && (
                      <div style={{ fontSize: "0.75rem", color: "var(--primary)" }} className="mono">
                        📎 {ev.file_url}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
