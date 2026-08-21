import type { ApplicationStatus } from "@careerpilot/shared";

const STATUS_LABEL: Record<ApplicationStatus, string> = {
  saved: "Saved",
  applying: "Applying",
  applied: "Applied",
  interview: "Interview",
  offer: "Offer",
  rejected: "Rejected",
};

export default function StatusBadge({ status }: { status: ApplicationStatus }) {
  return <span className={`status-badge status-${status}`}>{STATUS_LABEL[status]}</span>;
}
