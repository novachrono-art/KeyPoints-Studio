/**
 * SendMomModal.jsx - Send Minutes of Meeting to Team Members via Email
 */

import { useState } from "react";
import { sendMomEmail } from "../services/api.js";
import { useToast } from "../context/ToastContext.jsx";
import "./NewMeetingModal.css";

export default function SendMomModal({ isOpen, onClose, meetingId, mom }) {
  const toast = useToast();
  const [emailInput, setEmailInput] = useState("");
  const [recipients, setRecipients] = useState(() => {
    try {
      const team = JSON.parse(localStorage.getItem("mom_team_members") || "[]");
      const validEmails = team
        .map((m) => m.email)
        .filter((e) => e && e.includes("@") && !e.endsWith("@workspace.local") && !e.endsWith("@company.com"));
      return validEmails;
    } catch {
      return [];
    }
  });
  const [customNote, setCustomNote] = useState("");
  const [includePdf, setIncludePdf] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);

  if (!isOpen) return null;

  function handleAddRecipient(e) {
    if (e) e.preventDefault();
    const raw = emailInput.trim();
    if (!raw) return;

    const parts = raw.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean);
    const newValid = parts.filter((p) => p.includes("@") && !recipients.includes(p));

    if (newValid.length === 0) {
      if (!parts.some((p) => p.includes("@"))) {
        setError("Please enter a valid email address.");
      }
      return;
    }

    setRecipients((prev) => [...prev, ...newValid]);
    setEmailInput("");
    setError(null);
  }

  function handleRemoveRecipient(email) {
    setRecipients((prev) => prev.filter((r) => r !== email));
  }

  async function handleSend() {
    let finalRecipients = [...recipients];
    if (emailInput.trim() && emailInput.includes("@")) {
      const extra = emailInput.trim();
      if (!finalRecipients.includes(extra)) {
        finalRecipients.push(extra);
      }
    }

    if (finalRecipients.length === 0) {
      setError("Please specify at least one recipient email address.");
      return;
    }

    setSending(true);
    setError(null);

    try {
      const res = await sendMomEmail(meetingId, {
        recipients: finalRecipients,
        custom_note: customNote.trim() || undefined,
        include_pdf: includePdf,
      });

      toast.success(res.message || `MOM sent to ${finalRecipients.length} recipient(s)!`);
      if (res.notice) {
        toast.info(res.notice);
      }
      onClose();
    } catch (err) {
      setError(err.message || "Unable to send MOM email. Please try again.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="new-meeting-overlay" onClick={onClose}>
      <div className="new-meeting-modal" style={{ maxWidth: "560px" }} onClick={(e) => e.stopPropagation()}>
        <div className="new-meeting-header">
          <div>
            <h3 className="new-meeting-title">Send MOM to Team</h3>
            <p className="new-meeting-sub">
              Email formatted Minutes of Meeting, decisions, and action items.
            </p>
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
            <div className="mb-4 rounded-xl bg-red-50/90 border border-red-200/90 px-3.5 py-2.5 text-xs text-danger backdrop-blur-md">
              {error}
            </div>
          )}

          {/* Meeting Title Banner */}
          <div className="p-3.5 rounded-xl border border-line/80 bg-white/70 backdrop-blur-md mb-3 shadow-sm">
            <span className="font-mono text-[11px] uppercase text-muted">Meeting</span>
            <p className="text-sm font-semibold text-ink truncate mt-0.5">
              {mom?.meeting_title || "Meeting Minutes"}
            </p>
            {mom?.action_items && (
              <p className="text-xs text-muted font-mono mt-1">
                {mom.action_items.length} action item(s) · {mom.decisions?.length || 0} decision(s)
              </p>
            )}
          </div>

          {/* Recipient Emails */}
          <div className="new-meeting-field">
            <label>Team Member Recipient Emails</label>
            <div className="flex gap-2">
              <input
                type="email"
                className="new-meeting-input"
                value={emailInput}
                onChange={(e) => {
                  setEmailInput(e.target.value);
                  if (error) setError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleAddRecipient();
                  }
                }}
                placeholder="colleague@company.com"
              />
              <button
                type="button"
                className="btn btn-ghost shrink-0 px-3 text-xs"
                onClick={handleAddRecipient}
              >
                + Add
              </button>
            </div>

            {/* Chips List */}
            {recipients.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2.5">
                {recipients.map((email) => (
                  <span
                    key={email}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-mono bg-white/80 border border-line text-ink backdrop-blur-md shadow-xs"
                  >
                    <span>{email}</span>
                    <button
                      type="button"
                      className="text-muted hover:text-danger text-sm leading-none"
                      onClick={() => handleRemoveRecipient(email)}
                    >
                      &times;
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Optional Note */}
          <div className="new-meeting-field">
            <label>Custom Note (Optional)</label>
            <textarea
              rows={2}
              className="new-meeting-input resize-y text-xs"
              value={customNote}
              onChange={(e) => setCustomNote(e.target.value)}
              placeholder="e.g. Please review your assigned action items before our next sprint sync."
            />
          </div>

          {/* Attachment options */}
          <div className="new-meeting-field">
            <label className="flex items-center gap-2.5 p-2.5 rounded-xl border border-line bg-white/70 backdrop-blur-md cursor-pointer hover:bg-white/90 transition-all">
              <input
                type="checkbox"
                checked={includePdf}
                onChange={(e) => setIncludePdf(e.target.checked)}
                className="rounded border-line text-accent focus:ring-accent"
              />
              <span className="text-xs font-medium text-ink">Attach MOM as PDF document</span>
            </label>
          </div>

          {/* Actions */}
          <div className="new-meeting-actions">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={onClose}
              disabled={sending}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleSend}
              disabled={sending}
            >
              {sending ? (
                <span className="flex items-center gap-2">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                  Sending email…
                </span>
              ) : (
                "✉️ Send MOM to Team"
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
