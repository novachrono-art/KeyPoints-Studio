/**
 * TeamPage.jsx - Team & Workspace Management
 */

import { useState } from "react";
import { useToast } from "../context/ToastContext.jsx";
import "./TeamPage.css";

export default function TeamPage({ user }) {
  const toast = useToast();
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("Editor");

  const [members, setMembers] = useState(() => {
    try {
      const saved = localStorage.getItem("mom_team_members");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {
      // fallback
    }
    return [
      {
        id: user?.id || 1,
        name: user?.username || "You",
        email: user?.email || "—",
        role: "Workspace Owner",
        status: "Active",
        joined: "Today",
      },
    ];
  });

  function handleInvite(e) {
    e.preventDefault();
    if (!inviteEmail.trim()) return;

    const newMember = {
      id: Date.now(),
      name: inviteEmail.split("@")[0],
      email: inviteEmail.trim(),
      role: inviteRole,
      status: "Invited",
      joined: "Today",
    };

    const next = [...members, newMember];
    setMembers(next);
    localStorage.setItem("mom_team_members", JSON.stringify(next));
    toast.success(`Invitation sent to ${inviteEmail}`);
    setInviteEmail("");
    setShowInviteModal(false);
  }

  function handleRemove(id, name) {
    const next = members.filter((m) => m.id !== id);
    setMembers(next);
    localStorage.setItem("mom_team_members", JSON.stringify(next));
    toast.info(`${name} removed from workspace.`);
  }

  return (
    <div className="team-page-root">
      <div className="team-page-wrap">
        <div className="team-header">
          <div>
            <h1 className="team-title">Team & Workspace</h1>
            <p className="team-sub">
              Manage workspace members, role permissions, and access controls.
            </p>
          </div>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setShowInviteModal(true)}
          >
            + Invite teammate
          </button>
        </div>

        {/* Deck Cards */}
        <div className="team-deck-grid">
          <div className="team-deck-card">
            <span className="lbl">Workspace Plan</span>
            <div className="val text-accent">Active Workspace</div>
            <p className="text-xs text-muted mt-2">Transcripts & MOM exports enabled</p>
          </div>
          <div className="team-deck-card">
            <span className="lbl">Seats Allocated</span>
            <div className="val">{members.length} / 10</div>
            <p className="text-xs text-muted mt-2">{10 - members.length} seats available</p>
          </div>
          <div className="team-deck-card">
            <span className="lbl">Audio Storage</span>
            <div className="val">0.0 / 50 GB</div>
            <p className="text-xs text-muted mt-2">100% storage available</p>
          </div>
        </div>

        {/* Members Table */}
        <div className="team-table-card">
          <div className="team-table-head">
            <span>Member</span>
            <span>Email</span>
            <span>Role</span>
            <span>Status</span>
            <span>Actions</span>
          </div>

          <div>
            {members.map((member) => (
              <div key={member.id} className="team-table-row">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-[rgba(79,169,140,0.15)] text-accent font-semibold flex items-center justify-center font-display text-xs shrink-0">
                    {(member.name?.[0] || "U").toUpperCase()}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-ink">{member.name}</p>
                    <p className="text-xs text-muted font-mono sm:hidden">{member.email}</p>
                  </div>
                </div>

                <div className="text-xs font-mono text-muted hidden sm:block">
                  {member.email}
                </div>

                <div>
                  <span className="font-mono text-xs text-ink bg-paper px-2.5 py-1 rounded border border-line">
                    {member.role}
                  </span>
                </div>

                <div>
                  <span
                    className={`inline-flex items-center gap-1.5 font-mono text-xs px-2 py-0.5 rounded-full ${
                      member.status === "Active"
                        ? "bg-[rgba(79,169,140,0.15)] text-accent"
                        : "bg-[rgba(217,164,65,0.15)] text-amber"
                    }`}
                  >
                    <i
                      className="w-1.5 h-1.5 rounded-full"
                      style={{ background: member.status === "Active" ? "var(--pine)" : "var(--amber)" }}
                    />
                    {member.status}
                  </span>
                </div>

                <div>
                  {member.role !== "Workspace Owner" && (
                    <button
                      type="button"
                      className="text-xs font-mono text-danger hover:underline"
                      onClick={() => handleRemove(member.id, member.name)}
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Invite Teammate Modal */}
      {showInviteModal && (
        <div className="new-meeting-overlay" onClick={() => setShowInviteModal(false)}>
          <div className="new-meeting-modal" onClick={(e) => e.stopPropagation()}>
            <div className="new-meeting-header">
              <div>
                <h3 className="new-meeting-title">Invite Teammate</h3>
                <p className="new-meeting-sub">Collaborate on meeting transcripts, MOMs, and audio logs.</p>
              </div>
              <button
                type="button"
                className="text-muted hover:text-ink text-lg p-1"
                onClick={() => setShowInviteModal(false)}
              >
                &times;
              </button>
            </div>

            <form onSubmit={handleInvite} className="new-meeting-body">
              <div className="new-meeting-field">
                <label>Email Address</label>
                <input
                  type="email"
                  required
                  className="new-meeting-input"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="colleague@company.com"
                />
              </div>

              <div className="new-meeting-field">
                <label>Role & Permissions</label>
                <select
                  className="new-meeting-input"
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value)}
                >
                  <option value="Producer / Editor">Producer / Editor (Full edit & export)</option>
                  <option value="Editor">Editor (Edit MOMs & Action Items)</option>
                  <option value="Viewer">Viewer (Read-only)</option>
                  <option value="Admin">Admin (Workspace settings)</option>
                </select>
              </div>

              <div className="new-meeting-actions">
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setShowInviteModal(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  Send Invitation
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
