import { useEffect, useMemo, useState } from "react";
import type { ApiErrorResponse, Application, ApplicationStatus } from "@careerpilot/shared";
import { API_BASE_URL } from "../lib/api";
import StatusBadge from "../components/StatusBadge";

type LoadState =
  | { status: "loading" }
  | { status: "loaded"; applications: Application[] }
  | { status: "error"; message: string };

const STATUS_PIPELINE: { value: ApplicationStatus; label: string }[] = [
  { value: "saved", label: "Saved" },
  { value: "applying", label: "Applying" },
  { value: "applied", label: "Applied" },
  { value: "interview", label: "Interview" },
  { value: "offer", label: "Offer" },
  { value: "rejected", label: "Rejected" },
];

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export default function Applications() {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [query, setQuery] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);

  async function load() {
    setState({ status: "loading" });
    try {
      const res = await fetch(`${API_BASE_URL}/api/applications`);
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as ApiErrorResponse | null;
        throw new Error(body?.error ?? `Failed to load applications (status ${res.status}).`);
      }
      const applications = (await res.json()) as Application[];
      setState({ status: "loaded", applications });
    } catch (err) {
      setState({
        status: "error",
        message: err instanceof Error ? err.message : "Failed to load applications.",
      });
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const applications = state.status === "loaded" ? state.applications : [];

  const counts = useMemo(() => {
    const c = new Map<ApplicationStatus, number>();
    for (const app of applications) c.set(app.status, (c.get(app.status) ?? 0) + 1);
    return c;
  }, [applications]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return applications;
    return applications.filter(
      (a) => a.company.toLowerCase().includes(q) || a.jobTitle.toLowerCase().includes(q),
    );
  }, [applications, query]);

  return (
    <section>
      <h1>Applications</h1>
      <p className="muted">
        Applications submitted through the CareerPilot extension appear here
        automatically — or add one yourself below.
      </p>

      <div className="pipeline">
        {STATUS_PIPELINE.map((step) => (
          <div className="pipeline-step" key={step.value}>
            <div className="pipeline-count">{counts.get(step.value) ?? "—"}</div>
            <div className="pipeline-label">{step.label}</div>
          </div>
        ))}
      </div>

      <div className="applications-toolbar">
        <input
          type="search"
          className="applications-search"
          placeholder="Search by company or role…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button type="button" className="add-job-btn" onClick={() => setShowAddForm((v) => !v)}>
          {showAddForm ? "Cancel" : "+ Add Application"}
        </button>
      </div>

      {showAddForm && (
        <AddApplicationForm
          onAdded={() => {
            setShowAddForm(false);
            void load();
          }}
        />
      )}

      {state.status === "loading" && (
        <div className="applications-loading">
          {[0, 1, 2].map((i) => (
            <div className="skeleton-row" key={i} />
          ))}
        </div>
      )}

      {state.status === "error" && (
        <div className="callout error">
          <strong>Couldn't load applications.</strong> {state.message}
        </div>
      )}

      {state.status === "loaded" && applications.length === 0 && (
        <div className="empty-state">
          <p className="dropzone-title">No applications yet</p>
          <p className="muted small">
            Apply to a job with the CareerPilot extension and it will show up
            here automatically.
          </p>
        </div>
      )}

      {state.status === "loaded" && applications.length > 0 && (
        <table className="applications-table">
          <thead>
            <tr>
              <th>Company</th>
              <th>Role</th>
              <th>Status</th>
              <th>Applied</th>
              <th>Source</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((app) => (
              <tr key={app.id}>
                <td className="cell-company">{app.company}</td>
                <td>
                  <a href={app.jobUrl} target="_blank" rel="noreferrer">
                    {app.jobTitle}
                  </a>
                  <div className="muted small">{hostnameOf(app.jobUrl)}</div>
                </td>
                <td>
                  <StatusBadge status={app.status} />
                </td>
                <td className="muted small">{formatDate(app.dateApplied)}</td>
                <td className="muted small">{app.source ?? "—"}</td>
                <td className="muted small">{app.notes ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function AddApplicationForm({ onAdded }: { onAdded: () => void }) {
  const [company, setCompany] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [jobUrl, setJobUrl] = useState("");
  const [status, setStatus] = useState<ApplicationStatus>("saved");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!company.trim() || !jobTitle.trim() || !jobUrl.trim()) {
      setError("Company, role, and job URL are required.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/api/applications`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company, jobTitle, jobUrl, status, notes: notes || undefined }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as ApiErrorResponse | null;
        throw new Error(body?.error ?? "Failed to add application.");
      }
      onAdded();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add application.");
      setSubmitting(false);
    }
  }

  return (
    <form className="add-job-form" onSubmit={handleSubmit}>
      <div className="add-job-row">
        <input
          placeholder="Company"
          value={company}
          onChange={(e) => setCompany(e.target.value)}
        />
        <input
          placeholder="Role"
          value={jobTitle}
          onChange={(e) => setJobTitle(e.target.value)}
        />
      </div>
      <div className="add-job-row">
        <input
          placeholder="Job URL"
          value={jobUrl}
          onChange={(e) => setJobUrl(e.target.value)}
        />
        <select value={status} onChange={(e) => setStatus(e.target.value as ApplicationStatus)}>
          {STATUS_PIPELINE.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </div>
      <input
        placeholder="Notes (optional)"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        className="add-job-notes"
      />
      {error && <p className="njob-error">{error}</p>}
      <button type="submit" className="add-job-btn primary" disabled={submitting}>
        {submitting ? "Adding…" : "Add"}
      </button>
    </form>
  );
}
