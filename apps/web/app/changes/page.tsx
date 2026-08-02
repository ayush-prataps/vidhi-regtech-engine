"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

interface ChangeItem {
  id: string;
  change_type: string; // 'new' | 'amended' | 'repealed'
  diff_summary: string;
  detected_at: string;
  new_clause_ref: string | null;
  new_summary: string | null;
  old_clause_ref: string | null;
  old_summary: string | null;
}

interface Stats {
  total: number;
  new: number;
  amended: number;
  repealed: number;
}

export default function VersionChangesPage() {
  const [changes, setChanges] = useState<ChangeItem[]>([]);
  const [stats, setStats] = useState<Stats>({ total: 0, new: 0, amended: 0, repealed: 0 });
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"all" | "new" | "amended" | "repealed">("all");

  useEffect(() => {
    async function fetchChanges() {
      try {
        const res = await fetch("/api/changes");
        const data = await res.json();
        if (data.changes) {
          setChanges(data.changes);
          if (data.stats) setStats(data.stats);
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    fetchChanges();
  }, []);

  const filteredChanges = changes.filter((c) => {
    if (activeTab === "all") return true;
    return c.change_type === activeTab;
  });

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Regulatory Version Changes (Diff Engine)</h1>
        <p className="page-subtitle">
          Automated cross-version diff comparing August 2024 vs June 2025 SEBI Master Circulars using bigram Jaccard similarity and preamble rescission lookup.
        </p>
      </div>

      {/* Stats Grid */}
      <div className="stat-grid">
        <div className="glass-card stat-card">
          <span className="stat-label">Total Changes</span>
          <span className="stat-value">{stats.total}</span>
        </div>
        <div className="glass-card stat-card">
          <span className="stat-label">New Obligations</span>
          <span className="stat-value" style={{ color: "var(--cyan)" }}>{stats.new}</span>
        </div>
        <div className="glass-card stat-card">
          <span className="stat-label">Amended Obligations</span>
          <span className="stat-value" style={{ color: "var(--primary)" }}>{stats.amended}</span>
        </div>
        <div className="glass-card stat-card">
          <span className="stat-label">Repealed / Rescinded</span>
          <span className="stat-value" style={{ color: "var(--rose)" }}>{stats.repealed}</span>
        </div>
      </div>

      {/* Verified Fixtures Highlight Section */}
      <div className="glass-card" style={{ marginBottom: "1.75rem", borderLeft: "4px solid var(--primary)" }}>
        <h3 style={{ fontSize: "1.1rem", color: "var(--text-primary)", marginBottom: "0.5rem" }}>
          🎯 Confirmed Real Test Cases (Verified Ground-Truth Fixtures)
        </h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "1rem", marginTop: "0.75rem" }}>
          <div style={{ background: "#0F172A", padding: "0.85rem", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-color)" }}>
            <span className="badge badge-repealed" style={{ marginBottom: "0.35rem" }}>Repealed (Appendix)</span>
            <div style={{ fontWeight: 600, fontSize: "0.875rem", color: "var(--text-primary)" }}>
              Rescission of Appendix Sr. nos. 119-130
            </div>
            <div style={{ fontSize: "0.785rem", color: "var(--text-muted)", marginTop: "0.25rem" }}>
              Circulars rescinded in 2025 preamble mapped to originating obligations.
            </div>
          </div>

          <div style={{ background: "#0F172A", padding: "0.85rem", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-color)" }}>
            <span className="badge badge-new" style={{ marginBottom: "0.35rem" }}>New (Section 17)</span>
            <div style={{ fontWeight: 600, fontSize: "0.875rem", color: "var(--text-primary)" }}>
              System Audit Tech Monitoring Framework
            </div>
            <div style={{ fontSize: "0.785rem", color: "var(--text-muted)", marginTop: "0.25rem" }}>
              New Section 17 introducing online portal, geo-location, & disincentives.
            </div>
          </div>

          <div style={{ background: "#0F172A", padding: "0.85rem", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-color)" }}>
            <span className="badge badge-new" style={{ marginBottom: "0.35rem" }}>New (Sections 71 & 72)</span>
            <div style={{ fontWeight: 600, fontSize: "0.875rem", color: "var(--text-primary)" }}>
              GIFT-IFSC SBU & NDS-OM Access
            </div>
            <div style={{ fontSize: "0.785rem", color: "var(--text-muted)", marginTop: "0.25rem" }}>
              Separate Business Units for GIFT IFSC and NDS-OM G-Sec trading access.
            </div>
          </div>
        </div>
      </div>

      {/* Filter Tabs */}
      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1.25rem" }}>
        <button
          className={`btn ${activeTab === "all" ? "btn-primary" : "btn-secondary"}`}
          onClick={() => setActiveTab("all")}
          id="tab-all-changes"
        >
          All Changes ({stats.total})
        </button>
        <button
          className={`btn ${activeTab === "new" ? "btn-primary" : "btn-secondary"}`}
          onClick={() => setActiveTab("new")}
          id="tab-new-changes"
        >
          New ({stats.new})
        </button>
        <button
          className={`btn ${activeTab === "amended" ? "btn-primary" : "btn-secondary"}`}
          onClick={() => setActiveTab("amended")}
          id="tab-amended-changes"
        >
          Amended ({stats.amended})
        </button>
        <button
          className={`btn ${activeTab === "repealed" ? "btn-primary" : "btn-secondary"}`}
          onClick={() => setActiveTab("repealed")}
          id="tab-repealed-changes"
        >
          Repealed ({stats.repealed})
        </button>
      </div>

      {/* Change Item List */}
      {loading ? (
        <div style={{ padding: "3rem", textAlign: "center", color: "var(--text-muted)" }}>
          Loading regulatory diff records...
        </div>
      ) : filteredChanges.length === 0 ? (
        <div className="glass-card" style={{ padding: "2rem", textAlign: "center", color: "var(--text-muted)" }}>
          No version changes found for this category.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.85rem" }}>
          {filteredChanges.map((item) => (
            <div
              key={item.id}
              className={`diff-item ${
                item.change_type === "new"
                  ? "diff-item-new"
                  : item.change_type === "amended"
                  ? "diff-item-amended"
                  : "diff-item-repealed"
              }`}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem", flexWrap: "wrap", gap: "0.5rem" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
                  {item.change_type === "new" && <span className="badge badge-new">New Obligation</span>}
                  {item.change_type === "amended" && <span className="badge badge-amended">Amended</span>}
                  {item.change_type === "repealed" && <span className="badge badge-repealed">Repealed</span>}

                  {item.new_clause_ref && (
                    <span className="badge badge-clause">2025 Clause {item.new_clause_ref}</span>
                  )}
                  {item.old_clause_ref && (
                    <span className="badge badge-clause" style={{ opacity: 0.7 }}>
                      2024 Clause {item.old_clause_ref}
                    </span>
                  )}
                </div>

                <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                  Detected {new Date(item.detected_at).toLocaleDateString()}
                </span>
              </div>

              <div style={{ fontWeight: 600, color: "var(--text-primary)", fontSize: "0.95rem", marginBottom: "0.35rem" }}>
                {item.new_summary || item.old_summary}
              </div>

              {item.diff_summary && (
                <div style={{ fontSize: "0.825rem", color: "var(--text-secondary)", background: "#0F172A", padding: "0.5rem 0.75rem", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-color)" }}>
                  💡 {item.diff_summary}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
