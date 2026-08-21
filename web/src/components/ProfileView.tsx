import type { CareerProfile } from "@careerpilot/shared";

function dateRange(start?: string, end?: string): string | null {
  if (start && end) return `${start} – ${end}`;
  if (start) return start;
  if (end) return end;
  return null;
}

export default function ProfileView({ profile }: { profile: CareerProfile }) {
  const contactLine = [
    profile.email,
    profile.phone,
    profile.location,
    profile.linkedin,
    profile.github,
    profile.portfolio,
  ].filter(Boolean);

  return (
    <div className="profile-view">
      <div className="profile-header">
        <h2>{profile.name ?? "Name not found in resume"}</h2>
        {contactLine.length > 0 ? (
          <p className="muted small">{contactLine.join(" · ")}</p>
        ) : (
          <p className="muted small">No contact details found in resume.</p>
        )}
      </div>

      <ProfileSection title="Work Authorization & Salary">
        <dl className="fact-grid">
          <dt>Work authorization</dt>
          <dd>{profile.workAuthorization ?? <span className="unavailable">Not stated</span>}</dd>
          <dt>Salary expectation</dt>
          <dd>{profile.salaryExpectation ?? <span className="unavailable">Not stated</span>}</dd>
        </dl>
      </ProfileSection>

      <ProfileSection title="Experience" empty={profile.experience.length === 0}>
        {profile.experience.map((exp, i) => (
          <div className="entry" key={i}>
            <div className="entry-title">
              {exp.title} · {exp.company}
            </div>
            <div className="muted small">
              {[dateRange(exp.startDate, exp.endDate), exp.location].filter(Boolean).join(" · ")}
            </div>
            {exp.highlights.length > 0 && (
              <ul>
                {exp.highlights.map((h, j) => (
                  <li key={j}>{h}</li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </ProfileSection>

      <ProfileSection title="Education" empty={profile.education.length === 0}>
        {profile.education.map((ed, i) => (
          <div className="entry" key={i}>
            <div className="entry-title">
              {ed.degree ? `${ed.degree}${ed.fieldOfStudy ? `, ${ed.fieldOfStudy}` : ""}` : ed.fieldOfStudy}
              {(ed.degree || ed.fieldOfStudy) && " · "}
              {ed.institution}
            </div>
            <div className="muted small">
              {[dateRange(ed.startDate, ed.endDate), ed.gpa ? `GPA ${ed.gpa}` : null]
                .filter(Boolean)
                .join(" · ")}
            </div>
          </div>
        ))}
      </ProfileSection>

      <ProfileSection title="Skills" empty={profile.skills.length === 0}>
        <div className="pill-row">
          {profile.skills.map((skill, i) => (
            <span className="pill" key={i}>
              {skill}
            </span>
          ))}
        </div>
      </ProfileSection>

      <ProfileSection title="Projects" empty={profile.projects.length === 0}>
        {profile.projects.map((p, i) => (
          <div className="entry" key={i}>
            <div className="entry-title">{p.name}</div>
            <p className="muted small">{p.description}</p>
            {p.technologies.length > 0 && (
              <div className="pill-row">
                {p.technologies.map((t, j) => (
                  <span className="pill" key={j}>
                    {t}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </ProfileSection>

      <ProfileSection title="Certifications" empty={profile.certifications.length === 0}>
        {profile.certifications.map((c, i) => (
          <div className="entry" key={i}>
            <div className="entry-title">{c.name}</div>
            <div className="muted small">{[c.issuer, c.date].filter(Boolean).join(" · ")}</div>
          </div>
        ))}
      </ProfileSection>
    </div>
  );
}

function ProfileSection({
  title,
  empty,
  children,
}: {
  title: string;
  empty?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="profile-section">
      <h3>{title}</h3>
      {empty ? <p className="unavailable">Not found in resume.</p> : children}
    </section>
  );
}
