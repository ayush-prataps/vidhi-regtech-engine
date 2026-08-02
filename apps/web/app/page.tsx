"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

interface Obligation {
  id: string;
  clause_ref: string;
  obligation_summary: string;
  action_required: string;
  intermediary_category: string;
  frequency: string | null;
  deadline_rule: string | null;
  status: string;
  extraction_confidence: number;
  evidence_count: number;
  circular_number: string;
}

interface Stats {
  total: number;
  active: number;
  needs_review: number;
  total_gaps: number;
}

export default function Home() {
  const [obligations, setObligations] = useState<Obligation[]>([]);
  const [stats, setStats] = useState<Stats>({ total: 0, active: 0, needs_review: 0, total_gaps: 0 });
  const [loading, setLoading] = useState(true);

  // Filter states
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [status, setStatus] = useState("all");
  const [gapFilter, setGapFilter] = useState("all");

  const fetchObligations = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.append("search", search);
      if (category !== "all") params.append("category", category);
      if (status !== "all") params.append("status", status);
      if (gapFilter !== "all") params.append("gap", gapFilter);

      const res = await fetch(`/api/obligations?${params.toString()}`);
      const data = await res.json();
      if (data.obligations) {
        setObligations(data.obligations);
        if (data.stats) setStats(data.stats);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchObligations();
    }, 200);
    return () => clearTimeout(timer);
  }, [search, category, status, gapFilter]);

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Regulatory Obligation Graph</h1>
        <p className="page-subtitle">
          Grounded SEBI Master Circular obligations extracted with 100% scoped recall. Filter by status, category, or evidence gap.
        </p>
      </div>

      {/* Metric Cards */}
      <div className="stat-grid">
        <div className="glass-card stat-card">
          <span className="stat-label">Total Obligations</span>
          <span className="stat-value">{stats.total}</span>
        </div>
        <div className="glass-card stat-card">
          <span className="stat-label">Active Obligations</span>
          <span className="stat-value" style={{ color: "var(--emerald)" }}>{stats.active}</span>
        </div>
        <div className="glass-card stat-card">
          <span className="stat-label">Needs Human Review</span>
          <span className="stat-value" style={{ color: "var(--amber)" }}>{stats.needs_review}</span>
        </div>
        <div className="glass-card stat-card">
          <span className="stat-label">Compliance Gaps</span>
          <span className="stat-value" style={{ color: "var(--rose)" }}>{stats.total_gaps}</span>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="filter-bar">
        <input
          type="text"
          placeholder="Search by summary, action, or clause ref (e.g. 20.2.2)..."
          className="search-input"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          id="search-obligations-input"
        />

        <select
          className="select-input"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          id="filter-category-select"
        >
          <option value="all">All Categories</option>
          <option value="stockbroker">Stockbroker</option>
          <option value="unspecified">Exchange / Other</option>
        </select>

        <select
          className="select-input"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          id="filter-status-select"
        >
          <option value="all">All Statuses</option>
          <option value="active">Active</option>
          <option value="needs_review">Needs Review</option>
          <option value="repealed">Repealed</option>
        </select>

        <select
          className="select-input"
          value={gapFilter}
          onChange={(e) => setGapFilter(e.target.value)}
          id="filter-gap-select"
        >
          <option value="all">All Evidence States</option>
          <option value="gapped">Gapped (Zero Evidence)</option>
          <option value="compliant">Compliant (Has Evidence)</option>
        </select>

        {(search || category !== "all" || status !== "all" || gapFilter !== "all") && (
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => {
              setSearch("");
              setCategory("all");
              setStatus("all");
              setGapFilter("all");
            }}
          >
            Reset Filters
          </button>
        )}
      </div>

      {/* Table */}
      <div className="table-container">
        <table className="data-table">
          <thead>
            <tr>
              <th>Clause Citation</th>
              <th>Obligation Summary & Action Required</th>
              <th>Category</th>
              <th>Frequency / Deadline</th>
              <th>Status</th>
              <th>Evidence</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} style={{ textAlign: "center", padding: "2rem", color: "var(--text-muted)" }}>
                  Loading grounded obligations...
                </td>
              </tr>
            ) : obligations.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ textAlign: "center", padding: "2rem", color: "var(--text-muted)" }}>
                  No matching obligations found for the selected filters.
                </td>
              </tr>
            ) : (
              obligations.map((ob) => (
                <tr key={ob.id}>
                  <td>
                    <span className="badge badge-clause">{ob.clause_ref}</span>
                  </td>
                  <td>
                    <div style={{ fontWeight: 600, color: "var(--text-primary)", marginBottom: "0.25rem" }}>
                      {ob.obligation_summary}
                    </div>
                    <div style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
                      {ob.action_required.slice(0, 120)}
                      {ob.action_required.length > 120 ? "..." : ""}
                    </div>
                  </td>
                  <td>
                    <span style={{ fontSize: "0.8rem", textTransform: "capitalize" }}>
                      {ob.intermediary_category}
                    </span>
                  </td>
                  <td>
                    <div style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>
                      {ob.frequency || "—"}
                    </div>
                    {ob.deadline_rule && (
                      <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "0.15rem" }}>
                        {ob.deadline_rule}
                      </div>
                    )}
                  </td>
                  <td>
                    {ob.status === "active" && (
                      <span className="badge badge-active">Active</span>
                    )}
                    {ob.status === "needs_review" && (
                      <span className="badge badge-review">Needs Review</span>
                    )}
                    {ob.status === "repealed" && (
                      <span className="badge badge-repealed">Repealed</span>
                    )}
                  </td>
                  <td>
                    {ob.evidence_count > 0 ? (
                      <span className="badge badge-active">
                        {ob.evidence_count} Submitted
                      </span>
                    ) : (
                      <span className="badge badge-gap">Gapped</span>
                    )}
                  </td>
                  <td>
                    <Link
                      href={`/obligations/${ob.id}`}
                      className="btn btn-outline btn-sm"
                      id={`manage-evidence-btn-${ob.id}`}
                    >
                      Details & Evidence →
                    </Link>
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
