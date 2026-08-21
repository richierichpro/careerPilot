import { useEffect, useMemo, useState } from "react";
import type { ApiErrorResponse, Application, ApplicationStatus } from "@careerpilot/shared";
import { API_BASE_URL } from "../lib/api";

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

function toDateInputValue(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

async function patchApplication(id: string, patch: Partial<Application>): Promise<Application> {
  const res = await fetch(`${API_BASE_URL}/api/applications/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ApiErrorResponse | null;
    throw new Error(body?.error ?? "Failed to save change.");
  }
  return (await res.json()) as Application;
}

export default function Applications() {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [query, setQuery] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

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

  // Optimistic: update the cell immediately, save in the background, roll
  // back only if the save actually fails — this is what makes it feel like
  // a spreadsheet instead of a form with a submit button.
  async function editCell(id: string, patch: Partial<Application>) {
    if (state.status !== "loaded") return;
    const previous = state.applications;
    setState({
      status: "loaded",
      applications: previous.map((a) => (a.id === id ? { ...a, ...patch } : a)),
    });
    try {
      await patchApplication(id, patch);
      setSaveError(null);
    } catch (err) {
      setState({ status: "loaded", applications: previous });
      setSaveError(err instanceof Error ? err.message : "Failed to save change.");
    }
  }

  async function deleteRow(id: string) {
    if (state.status !== "loaded") return;
    const previous = state.applications;
    setState({ status: "loaded", applications: previous.filter((a) => a.id !== id) });
    try {
      const res = await fetch(`${API_BASE_URL}/api/applications/${id}`, { method: "DELETE" });
      if (!res.ok && res.status !== 404) throw new Error(`status ${res.status}`);
      setSaveError(null);
    } catch (err) {
      setState({ status: "loaded", applications: previous });
      setSaveError(err instanceof Error ? err.message : "Failed to delete row.");
    }
  }

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
        automatically. Click any cell below to edit it directly.
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

      {saveError && (
        <div className="callout error">
          <strong>Couldn't save that change.</strong> {saveError}
        </div>
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
        <div className="sheet-scroll">
          <table className="applications-table sheet">
            <thead>
              <tr>
                <th>Company</th>
                <th>Role</th>
                <th>Job URL</th>
                <th>Status</th>
                <th>Applied</th>
                <th>Source</th>
                <th>Notes</th>
                <th className="sheet-actions-header"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((app) => (
                <tr key={app.id}>
                  <td className="cell-company">
                    <SheetText value={app.company} onCommit={(v) => editCell(app.id, { company: v })} />
                  </td>
                  <td>
                    <SheetText value={app.jobTitle} onCommit={(v) => editCell(app.id, { jobTitle: v })} />
                  </td>
                  <td>
                    <SheetText
                      value={app.jobUrl}
                      onCommit={(v) => editCell(app.id, { jobUrl: v })}
                      display={hostnameOf(app.jobUrl)}
                      href={app.jobUrl}
                    />
                  </td>
                  <td>
                    <select
                      className={`sheet-select status-${app.status}`}
                      value={app.status}
                      onChange={(e) => editCell(app.id, { status: e.target.value as ApplicationStatus })}
                    >
                      {STATUS_PIPELINE.map((s) => (
                        <option key={s.value} value={s.value}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      type="date"
                      className="sheet-input"
                      value={toDateInputValue(app.dateApplied)}
                      onChange={(e) => {
                        if (!e.target.value) return;
                        editCell(app.id, { dateApplied: new Date(e.target.value).toISOString() });
                      }}
                    />
                  </td>
                  <td>
                    <SheetText
                      value={app.source ?? ""}
                      onCommit={(v) => editCell(app.id, { source: v || undefined })}
                    />
                  </td>
                  <td>
                    <SheetText
                      value={app.notes ?? ""}
                      onCommit={(v) => editCell(app.id, { notes: v || undefined })}
                    />
                  </td>
                  <td className="sheet-actions-cell">
                    <button
                      type="button"
                      className="sheet-delete-btn"
                      title="Delete this application"
                      onClick={() => deleteRow(app.id)}
                    >
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function SheetText({
  value,
  onCommit,
  display,
  href,
}: {
  value: string;
  onCommit: (value: string) => void;
  display?: string;
  href?: string;
}) {
  const [draft, setDraft] = useState(value);

  useEffect(() => setDraft(value), [value]);

  return (
    <div className="sheet-cell-wrap">
      <input
        className="sheet-input"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft !== value) onCommit(draft);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
      />
      {display && href && (
        <a className="sheet-cell-sub" href={href} target="_blank" rel="noreferrer">
          {display}
        </a>
      )}
    </div>
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
