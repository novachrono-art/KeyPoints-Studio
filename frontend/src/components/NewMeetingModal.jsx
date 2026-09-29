/**
 * NewMeetingModal.jsx - New recording upload and transcription modal
 */

import { useState, useEffect, useRef } from "react";
import { uploadMeeting, transcribeMeeting } from "../services/api.js";
import { useToast } from "../context/ToastContext.jsx";
import "./NewMeetingModal.css";

const ALLOWED_EXTENSIONS = [".mp3", ".wav", ".m4a", ".mp4"];

export default function NewMeetingModal({ isOpen, onClose, onSuccess }) {
  const toast = useToast();
  const fileInputRef = useRef(null);

  const [file, setFile] = useState(null);
  const [title, setTitle] = useState("");
  const [language, setLanguage] = useState(() => {
    try {
      const s = JSON.parse(localStorage.getItem("mom_workspace_settings") || "{}");
      return s.defaultLang ?? "";
    } catch {
      return "";
    }
  });
  const [diarize, setDiarize] = useState(() => {
    try {
      const s = JSON.parse(localStorage.getItem("mom_workspace_settings") || "{}");
      return s.autoDiarize ?? true;
    } catch {
      return true;
    }
  });
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (isOpen) {
      try {
        const saved = localStorage.getItem("mom_workspace_settings");
        if (saved) {
          const parsed = JSON.parse(saved);
          if (parsed.defaultLang !== undefined) setLanguage(parsed.defaultLang);
          if (parsed.autoDiarize !== undefined) setDiarize(parsed.autoDiarize);
        }
      } catch {
        // fallback
      }
      setFile(null);
      setTitle("");
      setError(null);
      setUploading(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  function handleFileSelect(selectedFile) {
    if (!selectedFile) return;
    const ext = "." + selectedFile.name.split(".").pop().toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      setError(`Unsupported file type "${ext}". Allowed: ${ALLOWED_EXTENSIONS.join(", ")}`);
      return;
    }
    setError(null);
    setFile(selectedFile);
    if (!title) {
      const baseName = selectedFile.name.replace(/\.[^/.]+$/, "");
      setTitle(baseName);
    }
  }

  function handleDrop(e) {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files?.[0]) {
      handleFileSelect(e.dataTransfer.files[0]);
    }
  }

  async function handleStart() {
    if (!file) {
      setError("Please select an audio or video recording.");
      return;
    }

    setUploading(true);
    setError(null);
    try {
      // 1. Upload audio
      const uploadRes = await uploadMeeting(file);
      const meetingId = uploadRes.meeting_id;

      // 2. Start transcription in background
      await transcribeMeeting(meetingId, language || undefined, diarize);

      toast.success("Recording uploaded! Transcription started.");
      onClose();
      if (onSuccess) onSuccess(meetingId);
    } catch (err) {
      setError(err.message || "Failed to start meeting processing.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="new-meeting-overlay" onClick={onClose}>
      <div className="new-meeting-modal" onClick={(e) => e.stopPropagation()}>
        <div className="new-meeting-header">
          <div>
            <h3 className="new-meeting-title">New Recording</h3>
            <p className="new-meeting-sub">Upload audio to transcribe and extract meeting intelligence.</p>
          </div>
          <button
            type="button"
            className="text-muted hover:text-ink text-lg p-1"
            onClick={onClose}
          >
            &times;
          </button>
        </div>

        <div className="new-meeting-body">
          {error && (
            <div className="mb-4 rounded-lg bg-[rgba(217,105,79,0.15)] border border-[rgba(217,105,79,0.3)] px-3.5 py-2.5 text-xs text-danger">
              {error}
            </div>
          )}

          {/* Hidden File Input */}
          <input
            type="file"
            ref={fileInputRef}
            accept={ALLOWED_EXTENSIONS.join(",")}
            style={{ display: "none" }}
            onChange={(e) => handleFileSelect(e.target.files?.[0])}
          />

          {/* Drag & Drop Zone */}
          {!file ? (
            <div
              className={`dropzone-box ${isDragging ? "dragging" : ""}`}
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <div className="dropzone-icon">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
              </div>
              <p className="text-sm font-medium text-ink">
                Drag and drop audio recording, or <span className="text-accent underline">browse</span>
              </p>
              <p className="font-mono text-xs text-muted">Supports MP3, WAV, M4A, MP4 (up to 500MB)</p>
            </div>
          ) : (
            <div className="dropzone-file-selected">
              <div className="flex items-center gap-3 min-w-0">
                <div className="h-8 w-8 rounded-lg bg-[rgba(79,169,140,0.15)] text-accent flex items-center justify-center shrink-0">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 18V5l12-2v13" />
                    <circle cx="6" cy="18" r="3" />
                    <circle cx="18" cy="16" r="3" />
                  </svg>
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink truncate">{file.name}</p>
                  <p className="font-mono text-xs text-muted">
                    {(file.size / (1024 * 1024)).toFixed(2)} MB
                  </p>
                </div>
              </div>
              <button
                type="button"
                className="text-xs font-mono text-danger hover:underline shrink-0 ml-2"
                onClick={() => setFile(null)}
              >
                Change
              </button>
            </div>
          )}

          {/* Title Field */}
          <div className="new-meeting-field">
            <label htmlFor="modalTitle">Meeting Title</label>
            <input
              id="modalTitle"
              type="text"
              className="new-meeting-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Q3 Growth Sync & Roadmap"
            />
          </div>

          {/* Language & Diarization Options */}
          <div className="grid grid-cols-2 gap-3 new-meeting-field">
            <div>
              <label htmlFor="modalLang">Language</label>
              <select
                id="modalLang"
                className="new-meeting-input"
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
              >
                <option value="">Auto-detect (English / Hinglish)</option>
                <option value="en">English</option>
                <option value="hi">Hinglish (Hindi + English)</option>
              </select>
            </div>

            <div className="flex flex-col justify-end">
              <label
                htmlFor="modalDiarize"
                className="flex items-center gap-2.5 p-2 rounded-lg border border-line bg-paper cursor-pointer"
              >
                <input
                  id="modalDiarize"
                  type="checkbox"
                  checked={diarize}
                  onChange={(e) => setDiarize(e.target.checked)}
                  className="rounded border-line text-accent focus:ring-accent"
                />
                <span className="text-xs font-medium text-ink">Identify Speakers</span>
              </label>
            </div>
          </div>

          {/* Action buttons */}
          <div className="new-meeting-actions">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={onClose}
              disabled={uploading}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleStart}
              disabled={uploading || !file}
            >
              {uploading ? (
                <span className="flex items-center gap-2">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                  Uploading…
                </span>
              ) : (
                "Start transcription"
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
