/**
 * UploadCard.jsx
 *
 * Drag-and-drop / click-to-browse file picker for meeting recordings.
 * Validates the file extension client-side (a UX nicety - the
 * backend validates again regardless, since client-side checks can
 * always be bypassed).
 */

import { useRef, useState } from "react";

const ALLOWED_EXTENSIONS = [".mp3", ".wav", ".m4a", ".mp4"];

export default function UploadCard({ onFileSelected, disabled }) {
  const [isDragging, setIsDragging] = useState(false);
  const [validationError, setValidationError] = useState(null);
  const inputRef = useRef(null);

  function validateAndSelect(file) {
    if (!file) return;

    const extension = "." + file.name.split(".").pop().toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(extension)) {
      setValidationError(
        `Unsupported file type "${extension}". Allowed: ${ALLOWED_EXTENSIONS.join(", ")}`
      );
      return;
    }

    setValidationError(null);
    onFileSelected(file);
  }

  function handleDrop(event) {
    event.preventDefault();
    setIsDragging(false);
    if (disabled) return;
    validateAndSelect(event.dataTransfer.files?.[0]);
  }

  function handleBrowseClick() {
    if (!disabled) inputRef.current?.click();
  }

  return (
    <div>
      <div
        onClick={handleBrowseClick}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        className={[
          "flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed px-6 py-14 text-center transition-all cursor-pointer backdrop-blur-xl shadow-sm",
          disabled
            ? "cursor-not-allowed opacity-50 border-line bg-white/40"
            : isDragging
            ? "border-blue-500 bg-blue-50/90 shadow-lg shadow-blue-500/15"
            : "border-blue-200/80 bg-white/70 hover:border-blue-500 hover:bg-blue-50/60 hover:shadow-md",
        ].join(" ")}
      >
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-50 text-blue-600 shadow-sm border border-blue-100/80">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            className="h-7 w-7"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 16.5V4.5m0 0l-4 4m4-4l4 4M4 16.5v2.25A2.25 2.25 0 006.25 21h11.5A2.25 2.25 0 0020 18.75V16.5"
            />
          </svg>
        </div>
        <p className="font-display text-lg font-medium text-ink">
          Drop a recording here, or click to browse
        </p>
        <p className="text-sm text-muted">
          Supports {ALLOWED_EXTENSIONS.join(", ")}
        </p>
        <input
          ref={inputRef}
          type="file"
          accept={ALLOWED_EXTENSIONS.join(",")}
          className="hidden"
          onChange={(e) => validateAndSelect(e.target.files?.[0])}
        />
      </div>

      {validationError && (
        <p className="mt-3 text-sm text-danger font-medium" role="alert">
          {validationError}
        </p>
      )}
    </div>
  );
}
