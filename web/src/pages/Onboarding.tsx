import { useCallback, useRef, useState } from "react";
import type { ApiErrorResponse, ResumeUploadResponse } from "@careerpilot/shared";
import { API_BASE_URL } from "../lib/api";

type UploadState =
  | { status: "idle" }
  | { status: "uploading"; filename: string }
  | { status: "uploaded"; result: ResumeUploadResponse }
  | { status: "error"; message: string };

const ACCEPTED_EXTENSIONS = [".pdf", ".doc", ".docx", ".txt"];

export default function Onboarding() {
  const [state, setState] = useState<UploadState>({ status: "idle" });
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const uploadFile = useCallback(async (file: File) => {
    setState({ status: "uploading", filename: file.name });

    const formData = new FormData();
    formData.append("resume", file);

    try {
      const res = await fetch(`${API_BASE_URL}/api/resume/upload`, {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as ApiErrorResponse | null;
        throw new Error(body?.error ?? `Upload failed (status ${res.status}).`);
      }

      const result = (await res.json()) as ResumeUploadResponse;
      setState({ status: "uploaded", result });
    } catch (err) {
      setState({
        status: "error",
        message: err instanceof Error ? err.message : "Upload failed.",
      });
    }
  }, []);

  const handleFiles = useCallback(
    (files: FileList | null) => {
      const file = files?.[0];
      if (!file) return;
      void uploadFile(file);
    },
    [uploadFile],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragging(false);
      handleFiles(e.dataTransfer.files);
    },
    [handleFiles],
  );

  return (
    <section>
      <h1>Career Profile</h1>
      <p className="muted">
        Upload your resume to build a structured Career Profile. AI parsing
        into editable sections is coming in the next milestone.
      </p>

      {state.status !== "uploaded" && (
        <div
          className={`dropzone${isDragging ? " dragging" : ""}${
            state.status === "uploading" ? " busy" : ""
          }`}
          onClick={() => state.status !== "uploading" && inputRef.current?.click()}
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
          {state.status === "uploading" ? (
            <p>Uploading {state.filename}…</p>
          ) : (
            <>
              <p className="dropzone-title">Drop your resume here, or click to browse</p>
              <p className="muted small">PDF, DOC, DOCX, or TXT — up to 5MB</p>
            </>
          )}
        </div>
      )}

      {state.status === "error" && (
        <div className="callout error">
          <strong>Upload failed.</strong> {state.message}
        </div>
      )}

      {state.status === "uploaded" && (
        <div className="callout success">
          <strong>{state.result.filename}</strong> uploaded (
          {(state.result.size / 1024).toFixed(0)} KB).
          <div>
            <button
              type="button"
              className="link-button"
              onClick={() => setState({ status: "idle" })}
            >
              Replace resume
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
