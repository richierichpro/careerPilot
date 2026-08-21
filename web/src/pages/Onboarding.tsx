import { useCallback, useRef, useState } from "react";
import type { ApiErrorResponse, CareerProfile, ResumeUploadResponse } from "@careerpilot/shared";
import { API_BASE_URL } from "../lib/api";
import ProfileView from "../components/ProfileView";

type Stage =
  | { status: "idle" }
  | { status: "uploading"; filename: string }
  | { status: "parsing"; filename: string }
  | { status: "parsed"; profile: CareerProfile }
  | { status: "error"; message: string };

const ACCEPTED_EXTENSIONS = [".pdf", ".doc", ".docx", ".txt"];

async function readError(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => null)) as ApiErrorResponse | null;
  return body?.error ?? fallback;
}

export default function Onboarding() {
  const [stage, setStage] = useState<Stage>({ status: "idle" });
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const uploadAndParse = useCallback(async (file: File) => {
    setStage({ status: "uploading", filename: file.name });

    try {
      const formData = new FormData();
      formData.append("resume", file);

      const uploadRes = await fetch(`${API_BASE_URL}/api/resume/upload`, {
        method: "POST",
        body: formData,
      });
      if (!uploadRes.ok) {
        throw new Error(await readError(uploadRes, `Upload failed (status ${uploadRes.status}).`));
      }
      const upload = (await uploadRes.json()) as ResumeUploadResponse;

      setStage({ status: "parsing", filename: file.name });

      const parseRes = await fetch(`${API_BASE_URL}/api/profile/parse`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resumeId: upload.resumeId }),
      });
      if (!parseRes.ok) {
        throw new Error(await readError(parseRes, `Parsing failed (status ${parseRes.status}).`));
      }
      const profile = (await parseRes.json()) as CareerProfile;

      setStage({ status: "parsed", profile });
    } catch (err) {
      setStage({
        status: "error",
        message: err instanceof Error ? err.message : "Something went wrong.",
      });
    }
  }, []);

  const handleFiles = useCallback(
    (files: FileList | null) => {
      const file = files?.[0];
      if (!file) return;
      void uploadAndParse(file);
    },
    [uploadAndParse],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragging(false);
      handleFiles(e.dataTransfer.files);
    },
    [handleFiles],
  );

  const busy = stage.status === "uploading" || stage.status === "parsing";

  return (
    <section>
      <h1>Career Profile</h1>
      <p className="muted">
        Upload your resume — AI reads it and builds a structured Career
        Profile below. Editable sections are coming in the next milestone.
      </p>

      {stage.status !== "parsed" && (
        <div
          className={`dropzone${isDragging ? " dragging" : ""}${busy ? " busy" : ""}`}
          onClick={() => !busy && inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
        >
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPTED_EXTENSIONS.join(",")}
            hidden
            onChange={(e) => handleFiles(e.target.files)}
          />
          {stage.status === "uploading" && <p>Uploading {stage.filename}…</p>}
          {stage.status === "parsing" && (
            <p>Analyzing {stage.filename} with AI — building your Career Profile…</p>
          )}
          {(stage.status === "idle" || stage.status === "error") && (
            <>
              <p className="dropzone-title">Drop your resume here, or click to browse</p>
              <p className="muted small">PDF, DOC, DOCX, or TXT — up to 5MB</p>
            </>
          )}
        </div>
      )}

      {stage.status === "error" && (
        <div className="callout error">
          <strong>Something went wrong.</strong> {stage.message}
        </div>
      )}

      {stage.status === "parsed" && (
        <>
          <div className="callout success">
            Career Profile built from your resume.
            <div>
              <button
                type="button"
                className="link-button"
                onClick={() => setStage({ status: "idle" })}
              >
                Replace resume
              </button>
            </div>
          </div>
          <ProfileView profile={stage.profile} />
        </>
      )}
    </section>
  );
}
