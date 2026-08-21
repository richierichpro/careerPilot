import { useEffect, useState } from "react";
import type { ApiErrorResponse, Application } from "@careerpilot/shared";
import { API_BASE_URL } from "../lib/api";
import StatusBadge from "../components/StatusBadge";

type LoadState =
  | { status: "loading" }
  | { status: "loaded"; applications: Application[] }
  | { status: "error"; message: string };

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

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setState({ status: "loading" });
      try {
        const res = await fetch(`${API_BASE_URL}/api/applications`);
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as ApiErrorResponse | null;
          throw new Error(body?.error ?? `Failed to load applications (status ${res.status}).`);
        }
        const applications = (await res.json()) as Application[];
        if (!cancelled) setState({ status: "loaded", applications });
      } catch (err) {
        if (!cancelled) {
          setState({
            status: "error",
            message: err instanceof Error ? err.message : "Failed to load applications.",
          });
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section>
      <h1>Applications</h1>
      <p className="muted">
        Applications submitted through the CareerPilot extension appear here
        automatically.
      </p>

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

      {state.status === "loaded" && state.applications.length === 0 && (
        <div className="empty-state">
          <p className="dropzone-title">No applications yet</p>
          <p className="muted small">
            Apply to a job with the CareerPilot extension and it will show up
            here automatically.
          </p>
        </div>
      )}

      {state.status === "loaded" && state.applications.length > 0 && (
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
            {state.applications.map((app) => (
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
