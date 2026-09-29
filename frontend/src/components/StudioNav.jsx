/**
 * StudioNav.jsx - Studio Global Navigation Header
 */

import { useState, useEffect } from "react";
import "./StudioNav.css";

export default function StudioNav({
  activeTab = "dashboard",
  onTabChange,
  onOpenCommandPalette,
  onOpenProfile,
  onNewMeeting,
  user,
  actionItemsCount = 0,
}) {
  const userId = user?.id || user?.username || "default";

  const [avatarUrl, setAvatarUrl] = useState(() => {
    return localStorage.getItem(`mom_profile_${userId}_avatar`) || "";
  });

  const [displayName, setDisplayName] = useState(() => {
    return localStorage.getItem(`mom_profile_${userId}_name`) || user?.username || "Studio User";
  });

  useEffect(() => {
    function sync() {
      setAvatarUrl(localStorage.getItem(`mom_profile_${userId}_avatar`) || "");
      setDisplayName(localStorage.getItem(`mom_profile_${userId}_name`) || user?.username || "Studio User");
    }
    window.addEventListener("mom_profile_updated", sync);
    return () => window.removeEventListener("mom_profile_updated", sync);
  }, [userId, user]);

  const initial = (displayName?.[0] || user?.username?.[0] || "U").toUpperCase();

  return (
    <header className="studio-nav-header">
      <div className="studio-nav-inner">
        {/* Left: Brand & Tabs */}
        <div className="studio-brand-section">
          <div
            className="studio-brand-logo"
            onClick={() => onTabChange("dashboard")}
            title="KeyPoints Studio Workspace"
          >
            <span className="studio-rec-dot" />
            <span className="studio-brand-title">KeyPoints Studio</span>
          </div>

          <nav className="studio-nav-tabs">
            <button
              type="button"
              className={`studio-tab-btn ${activeTab === "dashboard" ? "active" : ""}`}
              onClick={() => onTabChange("dashboard")}
            >
              📁 Meetings
            </button>
            <button
              type="button"
              className={`studio-tab-btn ${activeTab === "action-items" ? "active" : ""}`}
              onClick={() => onTabChange("action-items")}
            >
              ✓ Action Items
              {actionItemsCount > 0 && (
                <span className="studio-tab-badge">{actionItemsCount}</span>
              )}
            </button>
            <button
              type="button"
              className={`studio-tab-btn ${activeTab === "team" ? "active" : ""}`}
              onClick={() => onTabChange("team")}
            >
              👥 Team
            </button>
            <button
              type="button"
              className={`studio-tab-btn ${activeTab === "settings" ? "active" : ""}`}
              onClick={() => onTabChange("settings")}
            >
              ⚙️ Settings
            </button>
          </nav>
        </div>

        {/* Right: Quick actions, Theme, Profile, New Meeting */}
        <div className="studio-nav-actions">
          <button
            type="button"
            className="cmd-trigger-btn"
            onClick={onOpenCommandPalette}
            title="Open Command Palette (⌘K / Ctrl+K)"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <span className="label">Search...</span>
            <kbd className="font-mono text-[10px] bg-paper px-1.5 py-0.5 rounded border border-line">⌘K</kbd>
          </button>

          <button
            type="button"
            className="user-avatar-btn"
            onClick={onOpenProfile}
            title="Open Profile Card"
          >
            <span
              style={{
                width: "26px",
                height: "26px",
                borderRadius: "50%",
                background: "var(--pine)",
                color: "#FFFFFF",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "12px",
                fontWeight: "600",
                fontFamily: "var(--font-display)",
                overflow: "hidden",
                flexShrink: 0,
              }}
            >
              {avatarUrl ? (
                <img
                  src={avatarUrl}
                  alt="Profile"
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                />
              ) : (
                initial
              )}
            </span>
            <span className="font-medium text-xs hidden sm:inline">{displayName.split(" ")[0]}</span>
          </button>

          <button
            type="button"
            className="btn btn-primary"
            style={{ padding: "8px 14px", fontSize: "13px" }}
            onClick={onNewMeeting}
          >
            + New meeting
          </button>
        </div>
      </div>
    </header>
  );
}
