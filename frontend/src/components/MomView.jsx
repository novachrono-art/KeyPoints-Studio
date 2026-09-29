/**
 * MomView.jsx
 *
 * The editable Minutes of Meeting view: summary, participants,
 * discussion points, decisions, action items, pending issues - all
 * editable in place, with a single Save button that PUTs the whole
 * MOM back to the backend.
 */

import { useState, useEffect } from "react";
import EditableList from "./EditableList.jsx";
import ActionItemsTable from "./ActionItemsTable.jsx";
import SendMomModal from "./SendMomModal.jsx";
import { downloadExport, sendMomSlack } from "../services/api.js";
import { useToast } from "../context/ToastContext.jsx";

export default function MomView({ meetingId, mom, onChange, onSave, saveState }) {
  const toast = useToast();
  const [titleDraft, setTitleDraft] = useState(mom.meeting_title || "");
  const [exportError, setExportError] = useState("");
  const [busyExport, setBusyExport] = useState(null); // null | "pdf" | "docx"
  const [postingSlack, setPostingSlack] = useState(false);
  const [isSendModalOpen, setIsSendModalOpen] = useState(false);

  useEffect(() => {
    setTitleDraft(mom.meeting_title || "");
  }, [mom.meeting_title]);

  async function handleExport(format) {
    if (!meetingId) return;
    setExportError("");
    setBusyExport(format);
    try {
      await downloadExport(meetingId, format);
    } catch (err) {
      setExportError(err.message || "Download failed.");
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

  function updateField(field, value) {
    onChange({ ...mom, [field]: value });
  }

  function handleTitleChange(val) {
    setTitleDraft(val);
    updateField("meeting_title", val.trim() ? val : null);
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-white/80 bg-white/75 p-6 shadow-sm backdrop-blur-xl">
        <label className="mb-1.5 block font-mono text-xs uppercase tracking-wider text-slate-500 font-medium">
          Meeting title
        </label>
        <input
          type="text"
          value={titleDraft}
          onChange={(e) => handleTitleChange(e.target.value)}
          placeholder="Not specified"
          className="w-full rounded-xl border border-line bg-white/70 px-3.5 py-2.5 font-display text-lg text-ink placeholder:text-faint focus:border-accent focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-100 transition-all backdrop-blur-md"
        />
      </div>

      <div className="rounded-2xl border border-white/80 bg-white/75 p-6 shadow-sm backdrop-blur-xl">
        <label className="mb-1.5 block font-mono text-xs uppercase tracking-wider text-slate-500 font-medium">
          Summary
        </label>
        <textarea
          value={mom.summary}
          onChange={(e) => updateField("summary", e.target.value)}
          rows={3}
          className="w-full resize-y rounded-xl border border-line bg-white/70 px-3.5 py-2.5 text-sm leading-relaxed text-ink focus:border-accent focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-100 transition-all backdrop-blur-md"
        />
      </div>

      <div className="rounded-2xl border border-white/80 bg-white/75 p-6 shadow-sm backdrop-blur-xl">
        <EditableList
          label="Participants"
          items={mom.participants}
          onChange={(v) => updateField("participants", v)}
        />
      </div>

      <div className="rounded-2xl border border-white/80 bg-white/75 p-6 shadow-sm backdrop-blur-xl">
        <EditableList
          label="Discussion Points"
          items={mom.discussion_points}
          onChange={(v) => updateField("discussion_points", v)}
        />
      </div>

      <div className="rounded-2xl border border-white/80 bg-white/75 p-6 shadow-sm backdrop-blur-xl">
        <EditableList
          label="Decisions"
          items={mom.decisions}
          onChange={(v) => updateField("decisions", v)}
          emptyHint="No clear decisions were made in this meeting."
        />
      </div>

      <div className="rounded-2xl border border-white/80 bg-white/75 p-6 shadow-sm backdrop-blur-xl">
        <ActionItemsTable
          items={mom.action_items}
          onChange={(v) => updateField("action_items", v)}
        />
      </div>

      <div className="rounded-2xl border border-white/80 bg-white/75 p-6 shadow-sm backdrop-blur-xl">
        <EditableList
          label="Pending Issues"
          items={mom.pending_issues}
          onChange={(v) => updateField("pending_issues", v)}
        />
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-line/70 pt-6">
        <button
          onClick={onSave}
          disabled={saveState === "saving"}
          className="rounded-xl bg-gradient-to-r from-blue-600 to-blue-700 px-5 py-2.5 text-sm font-semibold text-white hover:from-blue-700 hover:to-blue-800 shadow-md shadow-blue-600/25 transition-all active:scale-[0.98] disabled:opacity-50"
        >
          {saveState === "saving" ? "Saving…" : "Save changes"}
        </button>
        {saveState === "saved" && (
          <span className="text-sm font-mono font-medium text-emerald-600">Saved ✓</span>
        )}
        {saveState === "error" && (
          <span className="text-sm font-mono font-medium text-red-600">
            Failed to save — please try again.
          </span>
        )}

        <div className="ml-auto flex flex-wrap items-center gap-2.5">
          {meetingId ? (
            <>
              <button
                onClick={() => setIsSendModalOpen(true)}
                className="rounded-xl bg-blue-50/90 border border-blue-200/90 px-4 py-2.5 text-sm font-semibold text-blue-700 hover:bg-blue-100/90 shadow-sm transition-all flex items-center gap-1.5 active:scale-[0.98] backdrop-blur-md"
              >
                <span>✉️</span> Send MOM to Team
              </button>
              <button
                onClick={handlePostToSlack}
                disabled={postingSlack}
                className="rounded-xl border border-line bg-white/80 px-4 py-2.5 text-sm font-medium text-ink hover:bg-slate-50 shadow-sm transition-all flex items-center gap-1.5 disabled:opacity-60 backdrop-blur-md"
                title="Post Minutes of Meeting and Action Items to connected Slack channel"
              >
                <span>💬</span> {postingSlack ? "Posting to Slack…" : "Post to Slack"}
              </button>
              <button
                onClick={() => handleExport("pdf")}
                disabled={busyExport !== null}
                className="rounded-xl border border-line bg-white/80 px-4 py-2.5 text-sm font-medium text-ink hover:bg-slate-50 shadow-sm transition-all disabled:opacity-60 backdrop-blur-md"
              >
                {busyExport === "pdf" ? "Downloading…" : "Download PDF"}
              </button>
              <button
                onClick={() => handleExport("docx")}
                disabled={busyExport !== null}
                className="rounded-xl border border-line bg-white/80 px-4 py-2.5 text-sm font-medium text-ink hover:bg-slate-50 shadow-sm transition-all disabled:opacity-60 backdrop-blur-md"
              >
                {busyExport === "docx" ? "Downloading…" : "Download DOCX"}
              </button>
            </>
          ) : (
            <span className="text-xs text-danger">
              Export unavailable — meeting ID missing. Try refreshing the page.
            </span>
          )}
        </div>
        {exportError && (
          <p className="mt-2 text-xs text-danger" role="alert">
            {exportError}
          </p>
        )}
      </div>
      <p className="text-right text-xs text-muted">
        Exports & email shares use the last saved version — save your changes first if you've edited anything.
      </p>

      {/* Send MOM Modal */}
      <SendMomModal
        isOpen={isSendModalOpen}
        onClose={() => setIsSendModalOpen(false)}
        meetingId={meetingId}
        mom={mom}
      />
    </div>
  );
}