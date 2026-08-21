import { useState } from "react";
import "./demoJob.css";

interface FormData {
  fullName: string;
  email: string;
  phone: string;
  location: string;
  school: string;
  degree: string;
  fieldOfStudy: string;
  graduationYear: string;
  employer: string;
  jobTitle: string;
  experienceSummary: string;
  skills: string;
  workAuthorized: string;
  salaryExpectation: string;
  whyNorthwind: string;
  pythonExperience: string;
}

const EMPTY_FORM: FormData = {
  fullName: "",
  email: "",
  phone: "",
  location: "",
  school: "",
  degree: "",
  fieldOfStudy: "",
  graduationYear: "",
  employer: "",
  jobTitle: "",
  experienceSummary: "",
  skills: "",
  workAuthorized: "",
  salaryExpectation: "",
  whyNorthwind: "",
  pythonExperience: "",
};

export default function DemoJobApplication() {
  const [form, setForm] = useState<FormData>(EMPTY_FORM);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function update<K extends keyof FormData>(key: K, value: FormData[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.fullName.trim() || !form.email.trim()) {
      setError("Full name and email are required.");
      return;
    }
    setError(null);
    setSubmitted(true);
  }

  if (submitted) {
    return (
      <div className="njob-page">
        <NorthwindHeader />
        <div className="njob-content">
          <div className="njob-confirmation">
            <h1>Application submitted</h1>
            <p>
              Thanks, {form.fullName.split(" ")[0] || "there"} — your application for{" "}
              <strong>Backend Engineer</strong> at Northwind Labs has been received. Our
              team will review your application and reach out if there's a fit.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="njob-page">
      <NorthwindHeader />
      <div className="njob-content">
        <div className="njob-job-header">
          <h1>Backend Engineer</h1>
          <p className="njob-meta">Northwind Labs · Remote · Full-time</p>
          <p className="njob-description">
            We're looking for a Backend Engineer to help build and scale the
            services powering our payments platform. You'll work across
            Node.js, PostgreSQL, and gRPC in a small, fast-moving team.
          </p>
        </div>

        <form className="njob-form" onSubmit={handleSubmit}>
          <fieldset>
            <legend>Personal Information</legend>
            <Field label="Full Name" required>
              <input
                type="text"
                value={form.fullName}
                onChange={(e) => update("fullName", e.target.value)}
                required
              />
            </Field>
            <Field label="Email Address" required>
              <input
                type="email"
                value={form.email}
                onChange={(e) => update("email", e.target.value)}
                required
              />
            </Field>
            <Field label="Phone Number">
              <input
                type="tel"
                value={form.phone}
                onChange={(e) => update("phone", e.target.value)}
              />
            </Field>
            <Field label="Current Location">
              <input
                type="text"
                value={form.location}
                onChange={(e) => update("location", e.target.value)}
              />
            </Field>
          </fieldset>

          <fieldset>
            <legend>Education</legend>
            <Field label="School / University">
              <input
                type="text"
                value={form.school}
                onChange={(e) => update("school", e.target.value)}
              />
            </Field>
            <Field label="Degree">
              <input
                type="text"
                value={form.degree}
                onChange={(e) => update("degree", e.target.value)}
              />
            </Field>
            <Field label="Field of Study">
              <input
                type="text"
                value={form.fieldOfStudy}
                onChange={(e) => update("fieldOfStudy", e.target.value)}
              />
            </Field>
            <Field label="Graduation Year">
              <input
                type="text"
                value={form.graduationYear}
                onChange={(e) => update("graduationYear", e.target.value)}
              />
            </Field>
          </fieldset>

          <fieldset>
            <legend>Experience</legend>
            <Field label="Most Recent Employer">
              <input
                type="text"
                value={form.employer}
                onChange={(e) => update("employer", e.target.value)}
              />
            </Field>
            <Field label="Job Title">
              <input
                type="text"
                value={form.jobTitle}
                onChange={(e) => update("jobTitle", e.target.value)}
              />
            </Field>
            <Field label="Tell us about your relevant experience for this role">
              <textarea
                rows={4}
                value={form.experienceSummary}
                onChange={(e) => update("experienceSummary", e.target.value)}
              />
            </Field>
          </fieldset>

          <fieldset>
            <legend>Skills</legend>
            <Field label="List your key skills">
              <textarea
                rows={2}
                value={form.skills}
                onChange={(e) => update("skills", e.target.value)}
              />
            </Field>
          </fieldset>

          <fieldset>
            <legend>Work Authorization & Compensation</legend>
            <Field label="Are you legally authorized to work in the United States?">
              <select
                value={form.workAuthorized}
                onChange={(e) => update("workAuthorized", e.target.value)}
              >
                <option value="">Select an answer</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            </Field>
            <Field label="What are your salary expectations for this role?">
              <input
                type="text"
                value={form.salaryExpectation}
                onChange={(e) => update("salaryExpectation", e.target.value)}
              />
            </Field>
          </fieldset>

          <fieldset>
            <legend>A Few More Questions</legend>
            <Field label="Why are you interested in working at Northwind Labs?">
              <textarea
                rows={3}
                value={form.whyNorthwind}
                onChange={(e) => update("whyNorthwind", e.target.value)}
              />
            </Field>
            <Field label="Describe your experience with Python.">
              <textarea
                rows={3}
                value={form.pythonExperience}
                onChange={(e) => update("pythonExperience", e.target.value)}
              />
            </Field>
          </fieldset>

          {error && <p className="njob-error">{error}</p>}

          <button type="submit" className="njob-submit">
            Submit Application
          </button>
        </form>
      </div>
    </div>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="njob-field">
      <span className="njob-label">
        {label}
        {required && <span className="njob-required"> *</span>}
      </span>
      {children}
    </label>
  );
}

function NorthwindHeader() {
  return (
    <header className="njob-header">
      <div className="njob-header-inner">
        <span className="njob-logo">Northwind Labs</span>
        <span className="njob-header-sub">Careers</span>
      </div>
    </header>
  );
}
