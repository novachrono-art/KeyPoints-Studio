/**
 * HomePage.jsx
 *
 * Orchestrates the full processing loop:
 *   1. User picks a file -> uploadMeeting()
 *   2. Automatically -> transcribeMeeting()  [now fires-and-returns immediately]
 *   3. Poll /progress until transcription completes
 *   4. Fetch transcript, user clicks "Generate MOM" -> generateMom()
 *   5. Poll /progress until MOM generation completes
 *   6. Fetch MOM; user can edit and Save -> updateMom()
 *
 * Phase 15 (Background Processing): both transcribeMeeting() and
 * generateMom() now return {status: "processing"} immediately. The UI
 * polls the real backend progress endpoint and only transitions to the
 * next step once the backend reports the job is done (progress 404 =
 * complete, or progress.stage == "error" = failed).
 *
 * State machine: "idle" -> "uploading" -> "processing" -> "transcribed"
 *   -> "generatingMom" -> "reviewingMom" (or "error" at any point)
 */

import { useEffect, useRef, useState } from "react";
import { useAuth } from "../context/AuthContext.jsx";
import UploadCard from "../components/UploadCard.jsx";
import PipelineStepper from "../components/PipelineStepper.jsx";
import TranscriptView from "../components/TranscriptView.jsx";
import MomView from "../components/MomView.jsx";
import {
  uploadMeeting,
  transcribeMeeting,
  generateMom,
  updateMom,
  getMeetingProgress,
  getTranscript,
  getMom,
} from "../services/api.js";

const STAGE_FOR_STATUS = {
  idle: "upload",
  uploading: "upload",
  processing: "process",
  transcribed: "process",
  generatingMom: "mom",
  reviewingMom: "review",
  error: "process",
};

/**
 * Poll GET /progress for a meeting until the job finishes.
 *
 * Resolves with { done: true } when the progress endpoint returns 404
 * (job completed successfully and progress was cleared).
 * Resolves with { done: false, error: message } when progress.stage === "error".
 * Never rejects — errors are surfaced as { done: false, error: ... }.
 *
 * onProgress(progressObj) is called on each successful poll tick so the
 * UI can update the live progress bar.
 */
async function pollUntilDone(meetingId, onProgress, intervalMs = 1500) {
  return new Promise((resolve) => {
    const timer = setInterval(async () => {
      try {
        const p = await getMeetingProgress(meetingId);
        if (p === null) {
          // 404 from the backend means the job cleared its progress = done.
          clearInterval(timer);
          resolve({ done: true });
          return;
        }
        onProgress(p);
        if (p.stage === "error") {
          clearInterval(timer);
          resolve({ done: false, error: p.error || p.message || "Processing failed." });
        }
      } catch {
        // Transient network error — keep polling.
      }
    }, intervalMs);
  });
}

export default function HomePage({ onDone }) {
  const [status, setStatus] = useState("idle");
  const [fileName, setFileName] = useState(null);
  const [meetingId, setMeetingId] = useState(null);
  const [transcript, setTranscript] = useState(null);
  const [mom, setMom] = useState(null);
  const [saveState, setSaveState] = useState("idle"); // idle | saving | saved | error
  const [errorMessage, setErrorMessage] = useState(null);
  const [progress, setProgress] = useState(null);
  const [diarize, setDiarize] = useState(() => {
    try {
      const s = JSON.parse(localStorage.getItem("mom_workspace_settings") || "{}");
      return s.autoDiarize ?? true;
    } catch {
      return true;
    }
  });
  const [language, setLanguage] = useState(() => {
    try {
      const s = JSON.parse(localStorage.getItem("mom_workspace_settings") || "{}");
      return s.defaultLang ?? "";
    } catch {
      return "";
    }
  });
  const { user, logout } = useAuth();

  async function handleFileSelected(file) {
    setFileName(file.name);
    setErrorMessage(null);
    setStatus("uploading");

    let uploadResult;
    try {
      uploadResult = await uploadMeeting(file);
    } catch (err) {
      setErrorMessage(err.message);
      setStatus("error");
      return;
    }

    const mid = uploadResult.meeting_id;
    setMeetingId(mid);
    setStatus("processing");
    setProgress(null);

    // Phase 15: fire transcription (returns immediately) then poll.
    try {
      await transcribeMeeting(mid, language || null, diarize);
    } catch (err) {
      setErrorMessage(err.message);
      setStatus("error");
      return;
    }

    const result = await pollUntilDone(mid, setProgress);
    if (!result.done) {
      setErrorMessage(result.error || "Transcription failed.");
      setStatus("error");
      return;
    }

    // Fetch the completed transcript.
    try {
      const transcriptData = await getTranscript(mid);
      setTranscript(transcriptData);
      setProgress(null);
      setStatus("transcribed");
    } catch (err) {
      setErrorMessage(err.message);
      setStatus("error");
    }
  }

  async function handleGenerateMom() {
    setErrorMessage(null);
    setStatus("generatingMom");
    setProgress(null);

    // Phase 15: fire MOM generation (returns immediately) then poll.
    try {
      await generateMom(meetingId);
    } catch (err) {
      setErrorMessage(err.message);
      setStatus("error");
      return;
    }

    const result = await pollUntilDone(meetingId, setProgress);
    if (!result.done) {
      setErrorMessage(result.error || "MOM generation failed.");
      setStatus("error");
      return;
    }

    // Fetch the completed MOM.
    try {
      const momData = await getMom(meetingId);
      setMom(momData);
      setProgress(null);
      setStatus("reviewingMom");
    } catch (err) {
      setErrorMessage(err.message);
      setStatus("error");
    }
  }

  async function handleSaveMom() {
    setSaveState("saving");
    try {
      const saved = await updateMom(meetingId, mom);
      setMom(saved);
      setSaveState("saved");
      setTimeout(() => setSaveState("idle"), 2000);
    } catch {
      setSaveState("error");
    }
  }

  function handleReset() {
    setStatus("idle");
    setFileName(null);
    setMeetingId(null);
    setTranscript(null);
    setMom(null);
    setSaveState("idle");
    setErrorMessage(null);
    setProgress(null);
    // diarize toggle intentionally preserved across resets so the user
    // doesn't have to re-enable it every time they upload another file.
  }

  return (
    <div className="min-h-full">
      <header className="border-b border-white/80 bg-white/75 backdrop-blur-xl shadow-sm">
        <div className="mx-auto flex max-w-3xl items-start justify-between gap-4 px-6 py-6">
          <div>
            {onDone && (
              <button
                onClick={onDone}
                className="mb-1 text-sm font-medium text-accent hover:underline"
              >
                ← Back to dashboard
              </button>
            )}
            <h1 className="font-display text-2xl font-semibold text-ink">
              KeyPoints Studio
            </h1>
            <p className="mt-1 text-sm text-muted">
              Upload a recording to get a transcript and editable minutes of meeting.
            </p>
          </div>
          {user && (
            <div className="text-right">
              <p className="font-mono text-xs text-muted">Signed in as <span className="text-ink font-semibold">{user.username}</span></p>
              <button
                onClick={logout}
                className="mt-1 text-xs font-mono text-accent hover:underline"
              >
                Log out
              </button>
            </div>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-10">
        <div className="mb-8">
          <PipelineStepper currentStage={STAGE_FOR_STATUS[status]} />
        </div>

        {status === "idle" && (
          <div>
            <UploadCard onFileSelected={handleFileSelected} disabled={false} />

            {/* Phase 14: Speaker diarization toggle */}
            <label
              htmlFor="diarize-toggle"
              className="mt-4 flex cursor-pointer items-center gap-3 rounded-2xl border border-white/85 bg-white/75 px-5 py-4 hover:border-blue-300 transition-all backdrop-blur-xl shadow-sm"
            >
              <div className="relative flex-shrink-0">
                <input
                  type="checkbox"
                  id="diarize-toggle"
                  checked={diarize}
                  onChange={(e) => setDiarize(e.target.checked)}
                  className="peer sr-only"
                />
                <div className="h-6 w-11 rounded-full bg-slate-300 peer-checked:bg-blue-600 transition-colors" />
                <div className="absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white transition-transform peer-checked:translate-x-5 shadow-sm" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-ink">
                  Identify speakers (diarization)
                </p>
                <p className="text-xs text-muted">
                  Groups spoken segments by speaker (Speaker 1, Speaker 2, etc.).
                  Takes slightly longer.
                </p>
              </div>
            </label>
          </div>
        )}

        {status === "uploading" && (
          <div className="rounded-2xl border border-white/85 bg-white/75 px-6 py-14 text-center backdrop-blur-xl shadow-sm">
            <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-accent-soft border-t-accent" />
            <p className="font-display text-lg text-ink">Uploading recording…</p>
            <p className="mt-1 text-sm text-muted">{fileName}</p>
          </div>
        )}

        {(status === "processing" || status === "generatingMom") && (
          <div className="rounded-2xl border border-white/85 bg-white/75 px-6 py-14 text-center backdrop-blur-xl shadow-sm">
            <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-accent-soft border-t-accent" />
            <p className="font-display text-lg text-ink">
              {status === "processing" && (
                diarize
                  ? "Processing audio, transcribing and identifying speakers…"
                  : "Processing audio and transcribing…"
              )}
              {status === "generatingMom" && "Generating minutes of meeting…"}
            </p>
            {(status === "processing" || status === "generatingMom") &&
              progress && (
                <div className="mx-auto mt-4 max-w-xs">
                  <p className="text-sm text-muted">{progress.message}</p>
                  {typeof progress.percent === "number" && (
                    <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
                      <div
                        className="h-full rounded-full bg-accent transition-all duration-300"
                        style={{ width: `${progress.percent}%` }}
                      />
                    </div>
                  )}
                </div>
              )}
          </div>
        )}

        {status === "error" && (
          <div className="rounded-2xl border border-brick/40 bg-brick/10 px-6 py-8 backdrop-blur-md">
            <p className="font-medium text-danger">Something went wrong</p>
            <p className="mt-1 text-sm text-danger/90">{errorMessage}</p>
            <button
              onClick={handleReset}
              className="mt-4 rounded-xl bg-white/80 px-4 py-2 text-sm font-medium text-ink border border-line hover:bg-slate-50 shadow-sm"
            >
              Start over
            </button>
          </div>
        )}

        {status === "transcribed" && transcript && (
          <div>
            <div className="mb-4 flex items-center justify-between">
              <p className="text-sm text-muted">
                Meeting ID: <span className="font-mono text-xs text-ink">{meetingId}</span>
              </p>
              <button
                onClick={handleReset}
                className="text-sm font-medium text-accent hover:underline"
              >
                Upload another
              </button>
            </div>
            <TranscriptView transcript={transcript} />
            <button
              onClick={handleGenerateMom}
              className="mt-6 w-full rounded-xl bg-gradient-to-r from-blue-600 to-blue-700 px-5 py-3 text-sm font-semibold text-white hover:from-blue-700 hover:to-blue-800 transition-all shadow-md shadow-blue-500/25 active:scale-[0.98]"
            >
              Generate MOM
            </button>
          </div>
        )}

        {status === "reviewingMom" && mom && (
          <div>
            <div className="mb-4 flex items-center justify-between">
              <p className="text-sm text-muted">
                Meeting ID: <span className="font-mono text-xs text-ink">{meetingId}</span>
              </p>
              <button
                onClick={handleReset}
                className="text-sm font-medium text-accent hover:underline"
              >
                Upload another
              </button>
            </div>
            <MomView
              meetingId={meetingId}
              mom={mom}
              onChange={setMom}
              onSave={handleSaveMom}
              saveState={saveState}
            />
          </div>
        )}
      </main>
    </div>
  );
}