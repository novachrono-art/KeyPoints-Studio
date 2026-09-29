/**
 * MeetingDetail.jsx (Linear & Raycast Inspired UI/UX Redesign)
 *
 * Responsive Split Canvas (Left: Synchronized Transcript, Right: Editable MOM)
 * Floating Frosted Glass Dock with Cmd+S save, PDF, DOCX, Email, and Slack triggers.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  deleteMeeting,
  downloadExport,
  generateMom,
  getMeetingDetail,
  getMeetingProgress,
  getMom,
  getTranscript,
  renameMeeting,
  sendMomSlack,
  updateMom,
} from "../services/api.js";
import { useToast } from "../context/ToastContext.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import TranscriptView from "../components/TranscriptView.jsx";
import MomView from "../components/MomView.jsx";
import SendMomModal from "../components/SendMomModal.jsx";

/** Statuses where a background job is actively running. */
const ACTIVE_STATUSES = new Set(["transcribing", "generating_mom"]);

export default function MeetingDetail({ meetingId, onBack }) {
  const toast = useToast();
  const [meeting, setMeeting] = useState(null);
  const [tab, setTab] = useState("mom"); // "transcript" | "mom"
  const [viewMode, setViewMode] = useState("split"); // "split" | "tabs"
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [transcript, setTranscript] = useState(null);
  const [mom, setMom] = useState(null);
  const [transcriptLoading, setTranscriptLoading] = useState(false);
  const [momLoading, setMomLoading] = useState(false);
  const [generatingMom, setGeneratingMom] = useState(false);
  const [saveState, setSaveState] = useState("idle"); // idle | saving | saved | error

  // Export and share modal states
  const [busyExport, setBusyExport] = useState(null); // null | "pdf" | "docx"
  const [postingSlack, setPostingSlack] = useState(false);
  const [isSendModalOpen, setIsSendModalOpen] = useState(false);

  // Rename meeting title state
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editTitleValue, setEditTitleValue] = useState("");
  const [renamingTitle, setRenamingTitle] = useState(false);

  // Phase 15: live progress for actively-running background jobs.
  const [jobProgress, setJobProgress] = useState(null);
  const pollingRef = useRef(null);

  // Delete state.
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState(null);

  async function handleDelete() {
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteMeeting(meetingId);
      onBack();
    } catch (err) {
      setDeleteError(err.message || "Unable to delete meeting.");
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getMeetingDetail(meetingId);
      setMeeting(data);
      if (data?.has_mom && !mom) {
        setMomLoading(true);
        getMom(meetingId)
          .then(setMom)
          .catch(() => {})
          .finally(() => setMomLoading(false));
      }
      if (data?.has_transcript && !transcript) {
        setTranscriptLoading(true);
        getTranscript(meetingId)
          .then(setTranscript)
          .catch(() => {})
          .finally(() => setTranscriptLoading(false));
      }
    } catch (err) {
      setError(err.message || "Unable to load meeting.");
    } finally {
      setLoading(false);
    }
  }, [meetingId, mom, transcript]);

  useEffect(() => {
    load();
  }, [load]);

  // Phase 15: start/stop progress polling based on meeting status.
  useEffect(() => {
    if (!meeting) return;

    if (ACTIVE_STATUSES.has(meeting.status)) {
      pollingRef.current = setInterval(async () => {
        try {
          const p = await getMeetingProgress(meetingId);
          if (p === null) {
            clearInterval(pollingRef.current);
            setJobProgress(null);
            setTranscript(null);
            setMom(null);
            const refreshed = await getMeetingDetail(meetingId);
            setMeeting(refreshed);
            if (refreshed?.has_mom) {
              setMomLoading(true);
              getMom(meetingId)
                .then(setMom)
                .catch(() => {})
                .finally(() => setMomLoading(false));
            }
            if (refreshed?.has_transcript) {
              setTranscriptLoading(true);
              getTranscript(meetingId)
                .then(setTranscript)
                .catch(() => {})
                .finally(() => setTranscriptLoading(false));
            }
          } else {
            setJobProgress(p);
            if (p.stage === "error") {
              clearInterval(pollingRef.current);
              setJobProgress(null);
              await load();
            }
          }
        } catch {
          // Transient error
        }
      }, 1500);
    }

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [meeting?.status, meetingId, load]);

  // Global ⌘S / Ctrl+S Save Keyboard Listener
  useEffect(() => {
    function handleKeyDown(e) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        handleSaveMom();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [mom]);

  async function handleGenerateMom() {
    setGeneratingMom(true);
    setError(null);
    try {
      await generateMom(meetingId);
      setMeeting((prev) => (prev ? { ...prev, status: "generating_mom" } : prev));
      setTab("mom");
      toast.info("MOM generation started in the background.");
    } catch (err) {
      setError(err.message || "Failed to trigger MOM generation.");
    } finally {
      setGeneratingMom(false);
    }
  }

  function startEditingTitle() {
    setEditTitleValue(mom?.meeting_title || meeting?.title || "");
    setIsEditingTitle(true);
  }

  async function handleSaveTitle(e) {
    if (e) e.preventDefault();
    const trimmed = editTitleValue.trim();
    if (!trimmed) {
      setIsEditingTitle(false);
      return;
    }
    setRenamingTitle(true);
    try {
      await renameMeeting(meetingId, trimmed);
      setMeeting((prev) => (prev ? { ...prev, title: trimmed } : prev));
      if (mom) {
        setMom((prev) => (prev ? { ...prev, meeting_title: trimmed } : prev));
      }
      setIsEditingTitle(false);
      toast.success("Meeting renamed successfully.");
    } catch (err) {
      setError(err.message || "Failed to rename meeting.");
    } finally {
      setRenamingTitle(false);
    }
  }

  async function handleSaveMom() {
    if (!mom) return;
    setSaveState("saving");
    try {
      const saved = await updateMom(meetingId, mom);
      setMom(saved);
      if (saved.meeting_title) {
        setMeeting((prev) => (prev ? { ...prev, title: saved.meeting_title } : prev));
      }
      setSaveState("saved");
      toast.success("All MOM changes saved successfully!");
      setTimeout(() => setSaveState("idle"), 2200);
    } catch {
      setSaveState("error");
      toast.error("Failed to save changes to server.");
    }
  }

  async function handleExport(format) {
    if (!meetingId) return;
    setBusyExport(format);
    try {
      await downloadExport(meetingId, format);
      toast.success(`Exported ${format.toUpperCase()} successfully.`);
    } catch (err) {
      toast.error(err.message || "Download failed.");
    } finally {
      setBusyExport(null);
    }
  }

  async function handlePostToSlack() {
    if (!meetingId) return;
    let webhookUrl = "";
    try {
      const s = JSON.parse(localStorage.getItem("mom_workspace_settings") || "{}");
      webhookUrl = s.slackWebhookUrl?.trim() || "";
    } catch {
      // fallback
    }

    if (!webhookUrl) {
      toast.error("Please configure your Slack Webhook URL in Settings first.");
      return;
    }

    setPostingSlack(true);
    try {
      await sendMomSlack(meetingId, { webhook_url: webhookUrl });
      toast.success("MOM posted to your Slack channel successfully!");
    } catch (err) {
      toast.error(err.message || "Failed to post to Slack.");
    } finally {
      setPostingSlack(false);
    }
  }

  return (
    <div className="min-h-screen">
      <header
        className="sticky top-0 z-30 border-b backdrop-blur-xl transition-all"
        style={{
          background: 'rgba(255, 255, 255, 0.78)',
          borderColor: 'rgba(255, 255, 255, 0.85)',
          boxShadow: '0 4px 20px -2px rgba(37, 99, 235, 0.04)',
        }}
      >
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-4 px-6 py-5">
          <div className="flex-1 min-w-0 pr-4">
            <button
              onClick={onBack}
              className="mb-1 text-sm font-medium text-accent hover:underline flex items-center gap-1"
            >
              ← Back to dashboard
            </button>
            {isEditingTitle ? (
              <form onSubmit={handleSaveTitle} className="my-1 flex items-center gap-2 max-w-lg">
                <input
                  type="text"
                  autoFocus
                  value={editTitleValue}
                  onChange={(e) => setEditTitleValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") setIsEditingTitle(false);
                  }}
                  className="w-full rounded-xl border border-blue-400 bg-white/90 px-3 py-1.5 text-lg font-semibold text-slate-900 shadow-sm focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-100 backdrop-blur-md"
                />
                <button
                  type="submit"
                  disabled={renamingTitle}
                  className="shrink-0 rounded-xl bg-blue-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 shadow-sm transition-all"
                >
                  {renamingTitle ? "Saving…" : "Save"}
                </button>
                <button
                  type="button"
                  onClick={() => setIsEditingTitle(false)}
                  className="shrink-0 rounded-xl border border-slate-200 bg-white/80 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
              </form>
            ) : (
              <div className="group flex items-center gap-2">
                <h1 className="font-display text-2xl font-semibold text-ink truncate">
                  {mom?.meeting_title || meeting?.title || "Meeting"}
                </h1>
                <button
                  type="button"
                  onClick={startEditingTitle}
                  className="opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity rounded-lg p-1 text-slate-400 hover:text-blue-600 hover:bg-blue-50"
                  title="Rename meeting"
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 20h9" />
                    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                  </svg>
                </button>
              </div>
            )}
            <p className="mt-1 font-mono text-xs text-muted">
              {meeting?.original_filename || ""}
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <div className="flex items-center gap-2">
              {meeting && <StatusBadge status={meeting.status} />}
              {meeting?.has_transcript && (
                <button
                  type="button"
                  onClick={handleGenerateMom}
                  disabled={generatingMom || ACTIVE_STATUSES.has(meeting?.status)}
                  className="rounded-xl bg-gradient-to-r from-blue-600 to-blue-700 px-4 py-2 text-xs font-semibold text-white hover:from-blue-700 hover:to-blue-800 shadow-md shadow-blue-600/25 transition-all active:scale-[0.98] disabled:opacity-60 flex items-center gap-1.5"
                >
                  {generatingMom || meeting?.status === "generating_mom" ? (
                    <>
                      <div className="h-3 w-3 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                      <span>Generating…</span>
                    </>
                  ) : (
                    <span>✨ Generate MOM</span>
                  )}
                </button>
              )}
            </div>
            {confirmDelete ? (
              <span className="inline-flex items-center gap-2 text-xs">
                <span className="text-danger font-medium">Delete this meeting?</span>
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  className="rounded-lg bg-brick px-2.5 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-60 shadow-sm"
                >
                  {deleting ? "Deleting…" : "Yes, delete"}
                </button>
                <button
                  onClick={() => setConfirmDelete(false)}
                  className="rounded-lg border border-line bg-white/80 px-2.5 py-1 text-xs text-ink hover:bg-slate-50"
                >
                  Cancel
                </button>
              </span>
            ) : (
              <button
                onClick={() => setConfirmDelete(true)}
                className="text-xs font-medium text-danger hover:underline"
              >
                Delete meeting
              </button>
            )}
            {deleteError && (
              <p className="text-xs text-danger" role="alert">
                {deleteError}
              </p>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 sm:px-6 py-8 pb-32">
        {loading ? (
          <div className="py-16 text-center text-slate-500">Loading meeting details…</div>
        ) : error ? (
          <div className="rounded-2xl border border-red-200 bg-red-50/80 p-6 shadow-sm backdrop-blur-md">
            <p className="font-semibold text-danger">Something went wrong</p>
            <p className="mt-1 text-sm text-danger/90">{error}</p>
            <button
              onClick={onBack}
              className="mt-4 rounded-xl border border-line bg-white/90 px-4 py-2 text-sm font-medium text-ink hover:bg-slate-50 shadow-sm"
            >
              Back to dashboard
            </button>
          </div>
        ) : (
          <>
            {/* Live progress banner for active background jobs */}
            {(ACTIVE_STATUSES.has(meeting?.status) || jobProgress) && (
              <div className="mb-6 rounded-2xl border border-indigo-200/80 bg-indigo-50/80 p-5 shadow-sm backdrop-blur-md">
                <div className="flex items-center gap-3">
                  <div className="h-5 w-5 flex-shrink-0 animate-spin rounded-full border-2 border-indigo-300 border-t-indigo-600" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-900">
                      {jobProgress?.message ||
                        (meeting?.status === "transcribing"
                          ? "Transcribing audio recording…"
                          : "Generating minutes of meeting…")}
                    </p>
                    {typeof jobProgress?.percent === "number" && (
                      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-indigo-200">
                        <div
                          className="h-full rounded-full bg-indigo-600 transition-all duration-300"
                          style={{ width: `${jobProgress.percent}%` }}
                        />
                      </div>
                    )}
                  </div>
                </div>
                <p className="mt-2 text-xs text-slate-600">
                  This page updates automatically in real-time as processing advances.
                </p>
              </div>
            )}

            {/* Layout Mode & Tab Controls Toolbar */}
            <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
              {/* Tab Switcher */}
              <div className="flex items-center gap-1.5 p-1 rounded-xl bg-slate-200/60 border border-white/80 backdrop-blur-md">
                <TabButton
                  active={tab === "mom"}
                  onClick={() => setTab("mom")}
                  label={meeting?.has_mom ? "Minutes of Meeting" : "✨ MOM (Generate)"}
                  disabled={!meeting?.has_transcript && !meeting?.has_mom}
                />
                <TabButton
                  active={tab === "transcript"}
                  onClick={() => setTab("transcript")}
                  label="Transcript & Diarization"
                  disabled={!meeting?.has_transcript}
                />
              </div>

              {/* View Mode Toggle: Split Canvas vs Single View (Shown on wide screens) */}
              {meeting?.has_transcript && meeting?.has_mom && (
                <div className="hidden xl:flex items-center gap-2 p-1 rounded-xl bg-slate-200/50 border border-white/70 backdrop-blur-md text-xs font-medium text-slate-600">
                  <button
                    type="button"
                    onClick={() => setViewMode("split")}
                    className={`px-3 py-1.5 rounded-lg transition-all ${
                      viewMode === "split"
                        ? "bg-white text-indigo-700 font-semibold shadow-xs"
                        : "hover:text-slate-900"
                    }`}
                  >
                    ◫ Split Canvas (45 / 55)
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewMode("tabs")}
                    className={`px-3 py-1.5 rounded-lg transition-all ${
                      viewMode === "tabs"
                        ? "bg-white text-indigo-700 font-semibold shadow-xs"
                        : "hover:text-slate-900"
                    }`}
                  >
                    ▭ Focused Tab View
                  </button>
                </div>
              )}
            </div>

            {/* MAIN CONTENT AREA */}
            {viewMode === "split" && meeting?.has_transcript && meeting?.has_mom ? (
              /* ==================== RESPONSIVE SPLIT CANVAS ==================== */
              <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
                {/* Left Canvas (45% on xl): Synchronized Transcript */}
                <div className="xl:col-span-5 space-y-4">
                  <div className="sticky top-24">
                    <div className="mb-2 flex items-center justify-between px-1">
                      <span className="font-mono text-xs uppercase tracking-wider font-semibold text-slate-500 flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-full bg-indigo-500" />
                        Synchronized Transcript
                      </span>
                    </div>
                    {transcriptLoading ? (
                      <Loading />
                    ) : transcript ? (
                      <div className="max-h-[calc(100vh-160px)] overflow-y-auto pr-1">
                        <TranscriptView transcript={transcript} />
                      </div>
                    ) : (
                      <NotReady message="Transcript loading or not available." />
                    )}
                  </div>
                </div>

                {/* Right Canvas (55% on xl): Editable MOM Document */}
                <div className="xl:col-span-7 space-y-4">
                  <div className="mb-2 flex items-center justify-between px-1">
                    <span className="font-mono text-xs uppercase tracking-wider font-semibold text-slate-500 flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full bg-emerald-500" />
                      Executive Minutes & Decisions
                    </span>
                  </div>
                  {momLoading ? (
                    <Loading />
                  ) : mom ? (
                    <MomView
                      meetingId={meetingId}
                      mom={mom}
                      onChange={setMom}
                      onSave={handleSaveMom}
                      saveState={saveState}
                    />
                  ) : (
                    <NotReady message="No MOM generated yet." />
                  )}
                </div>
              </div>
            ) : (
              /* ==================== FOCUSED TAB VIEW ==================== */
              <div className="max-w-4xl mx-auto">
                {tab === "transcript" && (
                  <>
                    {meeting?.has_transcript && !meeting?.has_mom && (
                      <div className="mb-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 rounded-2xl border border-blue-200/80 bg-blue-50/70 p-5 shadow-sm backdrop-blur-md">
                        <div>
                          <p className="text-sm font-semibold text-slate-900">Transcript is ready!</p>
                          <p className="text-xs text-slate-600 mt-0.5">Extract AI summary, discussion points, decisions, and action items with one click.</p>
                        </div>
                        <button
                          type="button"
                          onClick={handleGenerateMom}
                          disabled={generatingMom || ACTIVE_STATUSES.has(meeting?.status)}
                          className="shrink-0 rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 shadow-md shadow-blue-600/20 transition-all active:scale-[0.98] disabled:opacity-60"
                        >
                          {generatingMom || meeting?.status === "generating_mom" ? "Generating MOM…" : "✨ Generate MOM"}
                        </button>
                      </div>
                    )}
                    {transcriptLoading ? (
                      <Loading />
                    ) : transcript ? (
                      <TranscriptView transcript={transcript} />
                    ) : (
                      <NotReady message="No transcript for this meeting yet. It may still be processing." />
                    )}
                  </>
                )}

                {tab === "mom" &&
                  (momLoading ? (
                    <Loading />
                  ) : mom ? (
                    <MomView
                      meetingId={meetingId}
                      mom={mom}
                      onChange={setMom}
                      onSave={handleSaveMom}
                      saveState={saveState}
                    />
                  ) : meeting?.has_transcript ? (
                    <div
                      className="rounded-2xl border border-dashed border-blue-200/80 p-12 text-center shadow-sm backdrop-blur-xl"
                      style={{ background: 'rgba(255, 255, 255, 0.75)' }}
                    >
                      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-50/90 text-2xl text-blue-600 shadow-sm">
                        📋
                      </div>
                      <h3 className="font-display text-lg font-semibold text-slate-900">
                        Minutes of Meeting Not Generated Yet
                      </h3>
                      <p className="mx-auto mt-1 max-w-md text-sm text-slate-600 leading-relaxed">
                        We have the transcript ready. Extract key decisions, discussion items, and action items automatically with AI.
                      </p>
                      <button
                        type="button"
                        onClick={handleGenerateMom}
                        disabled={generatingMom || ACTIVE_STATUSES.has(meeting?.status)}
                        className="mt-6 inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-blue-700 px-5 py-2.5 text-sm font-semibold text-white hover:from-blue-700 hover:to-blue-800 shadow-md shadow-blue-600/25 transition-all active:scale-[0.98] disabled:opacity-60"
                      >
                        {generatingMom || meeting?.status === "generating_mom"
                          ? "Generating Minutes…"
                          : "✨ Generate MOM"}
                      </button>
                    </div>
                  ) : (
                    <NotReady message="No transcript available for this meeting yet. Transcribe audio first." />
                  ))}
              </div>
            )}
          </>
        )}
      </main>

      {/* Persistent Bottom-Centered Floating Frosted Glass Dock */}
      {meeting?.has_mom && mom && (
        <aside
          aria-label="Document actions dock"
          className="glass-dock fixed bottom-6 left-1/2 -translate-x-1/2 z-40 rounded-2xl px-4 py-2.5 flex items-center gap-3 shadow-dock animate-slideUp"
        >
          {/* Save Button with Cmd+S hotkey */}
          <button
            type="button"
            onClick={handleSaveMom}
            disabled={saveState === "saving"}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 shadow-md shadow-indigo-600/25 active:scale-[0.98] transition-all disabled:opacity-60"
            title="Save changes (⌘S / Ctrl+S)"
          >
            {saveState === "saving" ? (
              <>
                <div className="h-3 w-3 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                <span>Saving…</span>
              </>
            ) : saveState === "saved" ? (
              <span>Saved ✓</span>
            ) : (
              <>
                <span>Save</span>
                <kbd className="text-[10px] font-mono bg-white/20 px-1 py-0.5 rounded border border-white/30">⌘S</kbd>
              </>
            )}
          </button>

          <div className="h-4 w-px bg-slate-300/80" />

          {/* Export PDF */}
          <button
            type="button"
            onClick={() => handleExport("pdf")}
            disabled={busyExport !== null}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium text-slate-700 hover:bg-slate-100 hover:text-slate-900 transition-colors disabled:opacity-60"
            title="Download PDF Minutes"
          >
            <span>📄</span>
            <span>{busyExport === "pdf" ? "Exporting…" : "PDF"}</span>
          </button>

          {/* Export Word */}
          <button
            type="button"
            onClick={() => handleExport("docx")}
            disabled={busyExport !== null}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium text-slate-700 hover:bg-slate-100 hover:text-slate-900 transition-colors disabled:opacity-60"
            title="Download Word DOCX"
          >
            <span>📝</span>
            <span>{busyExport === "docx" ? "Exporting…" : "Word"}</span>
          </button>

          {/* Email Share */}
          <button
            type="button"
            onClick={() => setIsSendModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium text-indigo-700 hover:bg-indigo-50 transition-colors"
            title="Email minutes to team members"
          >
            <span>✉️</span>
            <span>Email</span>
          </button>

          {/* Slack Share */}
          <button
            type="button"
            onClick={handlePostToSlack}
            disabled={postingSlack}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium text-slate-700 hover:bg-slate-100 hover:text-slate-900 transition-colors disabled:opacity-60"
            title="Post minutes to connected Slack channel"
          >
            <span>💬</span>
            <span>{postingSlack ? "Posting…" : "Slack"}</span>
          </button>
        </aside>
      )}

      {/* Global Email Send Modal */}
      {isSendModalOpen && (
        <SendMomModal
          isOpen={isSendModalOpen}
          onClose={() => setIsSendModalOpen(false)}
          meetingId={meetingId}
          mom={mom}
        />
      )}
    </div>
  );
}

function TabButton({ active, onClick, label, disabled }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={active
        ? {
            background: 'linear-gradient(135deg, #2563EB 0%, #1D4ED8 100%)',
            color: '#FFFFFF',
            borderRadius: '10px',
            padding: '8px 16px',
            fontSize: '13.5px',
            fontWeight: '600',
            boxShadow: '0 4px 14px rgba(37,99,235,0.3)',
            cursor: disabled ? 'not-allowed' : 'pointer',
            opacity: disabled ? 0.5 : 1,
            border: 'none',
          }
        : {
            background: 'transparent',
            color: '#475569',
            borderRadius: '10px',
            padding: '8px 16px',
            fontSize: '13.5px',
            fontWeight: '500',
            cursor: disabled ? 'not-allowed' : 'pointer',
            opacity: disabled ? 0.5 : 1,
            border: 'none',
          }
      }
    >
      {label}
    </button>
  );
}

function NotReady({ message }) {
  return (
    <div
      className="rounded-2xl px-6 py-12 text-center shadow-sm backdrop-blur-xl"
      style={{ background: 'rgba(255, 255, 255, 0.7)', border: '2px dashed rgba(216, 229, 243, 0.85)' }}
    >
      <p className="text-sm" style={{ color: '#475569' }}>{message}</p>
    </div>
  );
}

function Loading() {
  return <div className="py-12 text-center" style={{ color: '#475569' }}>Loading…</div>;
}
