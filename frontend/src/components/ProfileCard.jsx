import { useState, useEffect, useRef } from "react";
import { useToast } from "../context/ToastContext.jsx";
import { listMeetings, changePassword } from "../services/api.js";
import "./ProfileCard.css";

function getInitials(name) {
  if (!name) return "U";
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

function formatJoinedDate(dateStr) {
  if (!dateStr) return "Today";
  try {
    const dt = new Date(dateStr);
    return dt.toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return "Today";
  }
}

export default function ProfileCard({
  user,
  stats,
  totalActionItems,
  onChangePassword,
  onSignOut,
  onClose,
}) {
  const toast = useToast();
  const userId = user?.id || user?.username || "default";
  const fileInputRef = useRef(null);

  const [activeTab, setActiveTab] = useState("profile"); // profile | usage | activity | password
  const [realMeetings, setRealMeetings] = useState([]);
  const [realStats, setRealStats] = useState(() => stats || { total: 0, completed: 0 });
  const [loadingActivity, setLoadingActivity] = useState(false);

  // Password change state
  const [showPasswordChange, setShowPasswordChange] = useState(false);
  const [curPw, setCurPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [pwBusy, setPwBusy] = useState(false);
  const [pwMsg, setPwMsg] = useState(null);

  // Profile Picture Avatar State
  const [avatarUrl, setAvatarUrl] = useState(() => {
    return localStorage.getItem(`mom_profile_${userId}_avatar`) || "";
  });

  // Profile Settings State
  const [isEditing, setIsEditing] = useState(false);
  const [displayName, setDisplayName] = useState(() => {
    return (
      localStorage.getItem(`mom_profile_${userId}_name`) ||
      user?.username ||
      "User"
    );
  });
  const [role, setRole] = useState(() => {
    return (
      localStorage.getItem(`mom_profile_${userId}_role`) ||
      "Workspace Owner"
    );
  });
  const [phone, setPhone] = useState(() => {
    return (
      localStorage.getItem(`mom_profile_${userId}_phone`) ||
      "—"
    );
  });
  const [location, setLocation] = useState(() => {
    return (
      localStorage.getItem(`mom_profile_${userId}_location`) ||
      "—"
    );
  });

  // Edit draft states
  const [draftName, setDraftName] = useState(displayName);
  const [draftRole, setDraftRole] = useState(role);
  const [draftPhone, setDraftPhone] = useState(phone);
  const [draftLocation, setDraftLocation] = useState(location);

  useEffect(() => {
    setDraftName(displayName);
    setDraftRole(role);
    setDraftPhone(phone);
    setDraftLocation(location);
  }, [displayName, role, phone, location]);

  useEffect(() => {
    async function fetchRealData() {
      setLoadingActivity(true);
      try {
        const res = await listMeetings({ pageSize: 5 });
        setRealMeetings(res.items || []);
        if (res.stats) {
          setRealStats(res.stats);
        }
      } catch {
        // silent fail
      } finally {
        setLoadingActivity(false);
      }
    }
    fetchRealData();
  }, []);

  function handleImageUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      toast.error("Please select a valid image file.");
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      toast.error("Image is too large. Please select an image under 5MB.");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result;
      setAvatarUrl(dataUrl);
      localStorage.setItem(`mom_profile_${userId}_avatar`, dataUrl);
      window.dispatchEvent(new Event("mom_profile_updated"));
      toast.success("Profile photo updated!");
    };
    reader.readAsDataURL(file);
  }

  function handleRemovePhoto(e) {
    if (e) e.stopPropagation();
    setAvatarUrl("");
    localStorage.removeItem(`mom_profile_${userId}_avatar`);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
    window.dispatchEvent(new Event("mom_profile_updated"));
    toast.info("Profile photo removed.");
  }

  function handleSaveEdit(e) {
    e.preventDefault();
    const finalName = draftName.trim() || user?.username || "User";
    const finalRole = draftRole.trim() || "Team Member";
    const finalPhone = draftPhone.trim() || "—";
    const finalLocation = draftLocation.trim() || "—";

    setDisplayName(finalName);
    setRole(finalRole);
    setPhone(finalPhone);
    setLocation(finalLocation);

    localStorage.setItem(`mom_profile_${userId}_name`, finalName);
    localStorage.setItem(`mom_profile_${userId}_role`, finalRole);
    localStorage.setItem(`mom_profile_${userId}_phone`, finalPhone);
    localStorage.setItem(`mom_profile_${userId}_location`, finalLocation);

    window.dispatchEvent(new Event("mom_profile_updated"));
    toast.success("Profile updated successfully");
    setIsEditing(false);
  }

  async function handlePasswordSubmit(e) {
    e.preventDefault();
    setPwMsg(null);
    if (newPw.length < 6) {
      setPwMsg({ type: "err", text: "New password must be at least 6 characters." });
      return;
    }
    if (newPw !== confirmPw) {
      setPwMsg({ type: "err", text: "New passwords do not match." });
      return;
    }
    setPwBusy(true);
    try {
      await changePassword(curPw, newPw);
      toast.success("Password changed successfully!");
      setCurPw("");
      setNewPw("");
      setConfirmPw("");
      setShowPasswordChange(false);
    } catch (err) {
      setPwMsg({ type: "err", text: err.message || "Failed to change password." });
    } finally {
      setPwBusy(false);
    }
  }

  function handleChangePasswordClick() {
    if (onChangePassword) {
      if (onClose) onClose();
      onChangePassword();
    } else {
      setShowPasswordChange(true);
    }
  }

  const effectiveStats = stats || realStats;
  const initials = getInitials(displayName);
  const email = user?.email || `${user?.username || "user"}@company.com`;
  const joinedFormatted = formatJoinedDate(user?.created_at);
  const meetingCount = effectiveStats?.total ?? 0;
  const actionItemsCount = totalActionItems || (effectiveStats?.completed ? effectiveStats.completed * 3 : 0);

  return (
    <div className="profile-modal-overlay" onClick={onClose}>
      <div className="profile-card" onClick={(e) => e.stopPropagation()}>
        <input
          type="file"
          ref={fileInputRef}
          accept="image/*"
          style={{ display: "none" }}
          onChange={handleImageUpload}
        />

        {/* Header ink strip */}
        <div className="profile-strip">
          <span className="profile-strip-label">
            <span className="profile-rec-dot" />
            KeyPoints Studio Profile
          </span>
          <div className="profile-strip-actions">
            {activeTab === "profile" && !isEditing && (
              <button
                type="button"
                className="profile-edit-btn"
                onClick={() => setIsEditing(true)}
              >
                Edit
              </button>
            )}
            {onClose && (
              <button
                type="button"
                className="profile-close-btn"
                onClick={onClose}
                title="Close"
              >
                &times;
              </button>
            )}
          </div>
        </div>

        {/* Subnav Tabs */}
        <nav className="profile-subnav">
          <button
            type="button"
            className={`profile-subtab-btn ${activeTab === "profile" ? "active" : ""}`}
            onClick={() => {
              setActiveTab("profile");
              setIsEditing(false);
            }}
          >
            Overview
          </button>
          <button
            type="button"
            className={`profile-subtab-btn ${activeTab === "usage" ? "active" : ""}`}
            onClick={() => setActiveTab("usage")}
          >
            Plan & Usage
          </button>
          <button
            type="button"
            className={`profile-subtab-btn ${activeTab === "activity" ? "active" : ""}`}
            onClick={() => setActiveTab("activity")}
          >
            Recent Activity
          </button>
        </nav>

        <div className="profile-card-scroll">
          {/* TAB 1: OVERVIEW */}
          {activeTab === "profile" && (
            <>
              <div className="profile-avatar-wrap">
                <div className="profile-avatar-container">
                  <div
                    className="profile-avatar"
                    onClick={() => fileInputRef.current?.click()}
                    title="Click to change profile picture"
                  >
                    {avatarUrl ? (
                      <img
                        src={avatarUrl}
                        alt={displayName}
                        className="profile-avatar-img"
                      />
                    ) : (
                      <span className="profile-avatar-initials">{initials}</span>
                    )}
                    <div className="profile-avatar-overlay">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                        <circle cx="12" cy="13" r="4" />
                      </svg>
                      <span>Upload</span>
                    </div>
                  </div>

                  <button
                    type="button"
                    className="profile-avatar-badge-btn"
                    onClick={() => fileInputRef.current?.click()}
                    title="Upload profile picture"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                      <circle cx="12" cy="13" r="4" />
                    </svg>
                  </button>
                </div>

                <div className="profile-photo-quick-actions">
                  <button
                    type="button"
                    className="profile-photo-link"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    {avatarUrl ? "Change photo" : "Upload photo"}
                  </button>
                  {avatarUrl && (
                    <button
                      type="button"
                      className="profile-photo-link remove"
                      onClick={handleRemovePhoto}
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>

              <div className="profile-body">
                <p className="profile-name">{displayName}</p>
                <p className="profile-role">{role}</p>

                <span className="profile-status-badge">
                  <i />
                  Active now
                </span>

                <div className="profile-stats">
                  <div className="profile-stat">
                    <span className="num">{realStats.total || 0}</span>
                    <span className="lbl">Meetings</span>
                  </div>
                  <div className="profile-stat">
                    <span className="num">{realStats.completed || 0}</span>
                    <span className="lbl">Completed</span>
                  </div>
                  <div className="profile-stat">
                    <span className="num">Active</span>
                    <span className="lbl">Status</span>
                  </div>
                </div>

                <div className="profile-divider" />

                {showPasswordChange ? (
                  <form onSubmit={handlePasswordSubmit} className="profile-edit-form">
                    <h4 className="font-mono text-xs uppercase text-muted mb-1">Change Account Password</h4>
                    {pwMsg && (
                      <div
                        className={`p-2.5 rounded-lg text-xs font-mono mb-2 ${
                          pwMsg.type === "err"
                            ? "bg-[rgba(217,105,79,0.15)] text-danger border border-[rgba(217,105,79,0.3)]"
                            : "bg-[rgba(79,169,140,0.15)] text-accent border border-[rgba(79,169,140,0.3)]"
                        }`}
                      >
                        {pwMsg.text}
                      </div>
                    )}
                    <div className="profile-edit-group">
                      <label>Current Password</label>
                      <input
                        type="password"
                        required
                        value={curPw}
                        onChange={(e) => setCurPw(e.target.value)}
                        placeholder="Current password"
                      />
                    </div>
                    <div className="profile-edit-group">
                      <label>New Password</label>
                      <input
                        type="password"
                        required
                        minLength={6}
                        value={newPw}
                        onChange={(e) => setNewPw(e.target.value)}
                        placeholder="At least 6 characters"
                      />
                    </div>
                    <div className="profile-edit-group">
                      <label>Confirm New Password</label>
                      <input
                        type="password"
                        required
                        minLength={6}
                        value={confirmPw}
                        onChange={(e) => setConfirmPw(e.target.value)}
                        placeholder="Re-type new password"
                      />
                    </div>
                    <div className="profile-actions" style={{ marginTop: "8px" }}>
                      <button
                        type="button"
                        className="profile-btn profile-btn-ghost"
                        onClick={() => {
                          setShowPasswordChange(false);
                          setPwMsg(null);
                        }}
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={pwBusy}
                        className="profile-btn profile-btn-primary"
                      >
                        {pwBusy ? "Updating…" : "Update Password"}
                      </button>
                    </div>
                  </form>
                ) : isEditing ? (
                  <form onSubmit={handleSaveEdit} className="profile-edit-form">
                    <div className="profile-edit-group">
                      <label>Display Name</label>
                      <input
                        type="text"
                        required
                        value={draftName}
                        onChange={(e) => setDraftName(e.target.value)}
                        placeholder="Your Full Name"
                      />
                    </div>
                    <div className="profile-edit-group">
                      <label>Role / Team</label>
                      <input
                        type="text"
                        value={draftRole}
                        onChange={(e) => setDraftRole(e.target.value)}
                        placeholder="e.g. Product Manager · Growth team"
                      />
                    </div>
                    <div className="profile-edit-group">
                      <label>Phone Number</label>
                      <input
                        type="text"
                        value={draftPhone}
                        onChange={(e) => setDraftPhone(e.target.value)}
                        placeholder="+91 98765 43210"
                      />
                    </div>
                    <div className="profile-edit-group">
                      <label>Location</label>
                      <input
                        type="text"
                        value={draftLocation}
                        onChange={(e) => setDraftLocation(e.target.value)}
                        placeholder="City, State, Country"
                      />
                    </div>
                    <div className="profile-actions" style={{ marginTop: "8px" }}>
                      <button
                        type="button"
                        className="profile-btn profile-btn-ghost"
                        onClick={() => setIsEditing(false)}
                      >
                        Cancel
                      </button>
                      <button type="submit" className="profile-btn profile-btn-primary">
                        Save changes
                      </button>
                    </div>
                  </form>
                ) : (
                  <div className="profile-info-list">
                    <div className="profile-info-row">
                      <div className="profile-info-icon">✉️</div>
                      <div className="profile-info-text">
                        <p className="k">Email</p>
                        <p className="v">{email}</p>
                      </div>
                    </div>

                    <div className="profile-info-row">
                      <div className="profile-info-icon">📞</div>
                      <div className="profile-info-text">
                        <p className="k">Phone</p>
                        <p className="v">{phone}</p>
                      </div>
                    </div>

                    <div className="profile-info-row">
                      <div className="profile-info-icon">📍</div>
                      <div className="profile-info-text">
                        <p className="k">Location</p>
                        <p className="v">{location}</p>
                      </div>
                    </div>

                    <div className="profile-info-row">
                      <div className="profile-info-icon">🗓️</div>
                      <div className="profile-info-text">
                        <p className="k">Joined Studio</p>
                        <p className="v">{joinedFormatted}</p>
                      </div>
                    </div>
                  </div>
                )}

                {!isEditing && !showPasswordChange && (
                  <div className="profile-actions">
                    <button
                      type="button"
                      className="profile-btn profile-btn-ghost"
                      onClick={handleChangePasswordClick}
                    >
                      Change password
                    </button>
                    <button
                      type="button"
                      className="profile-btn profile-btn-ghost profile-btn-danger-text"
                      onClick={onSignOut}
                    >
                      Sign out
                    </button>
                  </div>
                )}
              </div>
            </>
          )}

          {/* TAB 2: PLAN & USAGE */}
          {activeTab === "usage" && (
            <div className="p-6 text-left space-y-5">
              <div className="p-4 rounded-xl border border-line bg-paper">
                <div className="flex justify-between items-center mb-2">
                  <span className="font-mono text-xs uppercase text-muted">Current Plan</span>
                  <span className="font-mono text-xs bg-pine-tint text-accent px-2 py-0.5 rounded-full font-semibold">
                    Studio Free Tier
                  </span>
                </div>
                <h4 className="font-display text-xl text-ink font-semibold">Workspace</h4>
                <p className="text-xs text-muted mt-1">Includes AI meeting minutes, transcription, and speaker diarization.</p>
              </div>

              {/* Storage Meter */}
              <div className="space-y-2">
                <div className="flex justify-between text-xs font-mono">
                  <span className="text-muted">Storage Used</span>
                  <span className="text-ink font-semibold">
                    {realStats.total > 0 ? `${(realStats.total * 12.5).toFixed(1)} MB / 50 GB` : "0.0 MB / 50 GB (0%)"}
                  </span>
                </div>
                <div className="h-2 w-full bg-blue-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-accent rounded-full"
                    style={{ width: `${Math.min(100, Math.max(0, (realStats.total * 0.1)))}%` }}
                  />
                </div>
              </div>

              {/* Meetings Processed Meter */}
              <div className="space-y-2">
                <div className="flex justify-between text-xs font-mono">
                  <span className="text-muted">Meetings Processed</span>
                  <span className="text-ink font-semibold">{realStats.total || 0} / 50 meetings</span>
                </div>
                <div className="h-2 w-full bg-blue-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-accent rounded-full"
                    style={{ width: `${Math.min(100, ((realStats.total || 0) / 50) * 100)}%` }}
                  />
                </div>
              </div>

              <div className="pt-2">
                <button
                  type="button"
                  className="w-full btn btn-primary py-2.5 text-sm font-semibold"
                  onClick={() => toast.info("Your workspace is currently active and in good standing.")}
                >
                  Workspace Status: Active ✓
                </button>
              </div>
            </div>
          )}

          {/* TAB 3: RECENT ACTIVITY */}
          {activeTab === "activity" && (
            <div className="p-6 text-left space-y-4">
              <h4 className="font-mono text-xs uppercase text-muted mb-3">Recent Studio Actions</h4>
              
              {loadingActivity ? (
                <div className="py-8 text-center text-xs text-muted">Loading activity…</div>
              ) : realMeetings.length === 0 ? (
                <div className="py-10 text-center rounded-xl border border-dashed border-line bg-paper px-4">
                  <p className="text-sm font-medium text-ink">No recent activity</p>
                  <p className="text-xs text-muted mt-1">
                    Upload and transcribe your first meeting recording to see history here.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {realMeetings.map((m) => (
                    <div key={m.meeting_id} className="flex items-start gap-3 p-3 rounded-lg border border-line bg-paper">
                      <span className="text-accent text-base">🎙️</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-ink truncate">{m.title || "Meeting recording"}</p>
                        <p className="font-mono text-[11px] text-muted">
                          Status: {m.status} · {m.created_at ? formatJoinedDate(m.created_at) : "Recently"}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
