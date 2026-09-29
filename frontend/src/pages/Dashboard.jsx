/**
 * Dashboard.jsx (Studio Recording Archive & Console)
 *
 * Full-featured meetings archive:
 * - Top stats meters with live tick visualizers
 * - Subtab filter (My Meetings vs Team Meetings)
 * - Search with "/" hotkey and status filtering including "Has open action items"
 * - Bulk select + Bulk Delete / Bulk Export
 * - Skeleton loading rows & bespoke SVG empty state artwork
 * - Failed row state with retry action
 * - First-visit onboarding coachmark
 * - Toast notifications for user feedback
 */

import { useCallback, useEffect, useState, useRef, useMemo } from "react";
import { changePassword, deleteMeeting, generateMom, listMeetings, renameMeeting, transcribeMeeting } from "../services/api.js";
import { useAuth } from "../context/AuthContext.jsx";
import { useToast } from "../context/ToastContext.jsx";
import ProfileCard from "../components/ProfileCard.jsx";
import SkeletonRows from "../components/SkeletonRows.jsx";
import EmptyStateArtwork from "../components/EmptyStateArtwork.jsx";
import "./Dashboard.css";

function InteractiveWaveform({ status, isHovered, id = 1 }) {
  const bars = useMemo(() => {
    const seed = (id * 9301 + 49297) % 233280;
    const base = [35, 65, 45, 85, 95, 60, 40, 75, 90, 50, 70, 85, 40, 60];
    return base.map((h, i) => {
      const shift = ((seed + i * 17) % 30) - 15;
      return Math.min(100, Math.max(20, h + shift));
    });
  }, [id]);

  const isAnimated = status === "in_progress" || status === "transcribing" || isHovered;
  const color = status === "completed" ? "#10B981" : status === "failed" ? "#EF4444" : "#4F46E5";

  return (
    <div className="flex items-center gap-[2.5px] h-6 px-1.5 py-1 rounded-md bg-slate-100/80 border border-slate-200/60 w-fit">
      {bars.map((height, i) => {
        const dynamicHeight = isHovered ? Math.min(100, height * 1.15) : height;
        return (
          <span
            key={i}
            className="w-[2px] rounded-full transition-all duration-300 ease-out"
            style={{
              height: `${dynamicHeight}%`,
              backgroundColor: color,
              opacity: isHovered ? 0.95 : 0.65,
              animation: isAnimated ? `tick 1.4s ease-in-out infinite ${(i * 0.08).toFixed(2)}s` : "none",
            }}
          />
        );
      })}
    </div>
  );
}

function statusLabel(status) {
  switch (status) {
    case "completed":
      return "Completed";
    case "in_progress":
    case "uploaded":
      return "Processing";
    case "transcribed":
      return "Transcribed";
    case "failed":
      return "Failed";
    default:
      return status ? status.charAt(0).toUpperCase() + status.slice(1) : "Unknown";
  }
}

function statusClass(status) {
  if (status === "completed" || status === "transcribed") return "completed";
  if (status === "failed") return "failed";
  return "uploaded";
}

function fmtDate(value) {
  if (!value) return "—";
  try {
    const dt = new Date(value);
    return dt.toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return value;
  }
}

export default function Dashboard({ onOpenMeeting, onNewMeeting, onOpenActionItems }) {
  const { user, logout } = useAuth();
  const toast = useToast();
  const searchInputRef = useRef(null);

  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [sortOrder, setSortOrder] = useState("newest");
  const [subTab, setSubTab] = useState("my"); // "my" | "team"
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Bulk Selection
  const [selectedIds, setSelectedIds] = useState(new Set());

  // Onboarding Coachmark (dismissable, stored in localStorage)
  const [showCoachmark, setShowCoachmark] = useState(() => {
    return !localStorage.getItem("mom_coachmark_dismissed");
  });

  // Profile modal and avatar sync state
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [headerAvatar, setHeaderAvatar] = useState(() => {
    const userId = user?.id || user?.username || "default";
    return localStorage.getItem(`mom_profile_${userId}_avatar`) || "";
  });

  useEffect(() => {
    function syncProfile() {
      const userId = user?.id || user?.username || "default";
      setHeaderAvatar(localStorage.getItem(`mom_profile_${userId}_avatar`) || "");
    }
    window.addEventListener("mom_profile_updated", syncProfile);
    return () => window.removeEventListener("mom_profile_updated", syncProfile);
  }, [user]);

  // Expanded rows state
  const [expandedIds, setExpandedIds] = useState(new Set());

  // Password Modal
  const [showPwModal, setShowPwModal] = useState(false);
  const [curPw, setCurPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [pwMsg, setPwMsg] = useState(null);
  const [pwSubmitting, setPwSubmitting] = useState(false);

  // Delete State
  const [confirmId, setConfirmId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

  // Listen for "/" key to focus search
  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key === "/" && document.activeElement !== searchInputRef.current && document.activeElement?.tagName !== "INPUT") {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let sort = "updated_at";
      let order = "desc";
      if (sortOrder === "oldest") {
        sort = "updated_at";
        order = "asc";
      } else if (sortOrder === "title_asc") {
        sort = "title";
        order = "asc";
      } else if (sortOrder === "title_desc") {
        sort = "title";
        order = "desc";
      }

      const params = {
        page,
        pageSize,
        sort,
        order,
      };

      if (q.trim()) params.q = q.trim();
      if (statusFilter && statusFilter !== "has_actions") {
        params.status = statusFilter;
      }

      const res = await listMeetings(params);
      setData(res);
      setSelectedIds(new Set()); // Reset selections on page reload
    } catch (err) {
      setError(err.message || "Failed to load recordings archive.");
    } finally {
      setLoading(false);
    }
  }, [q, statusFilter, sortOrder, page, pageSize]);

  useEffect(() => {
    load();
  }, [load]);

  // Client-side filter for "has open action items"
  const visibleItems = useMemo(() => {
    if (!data?.items) return [];
    if (statusFilter === "has_actions") {
      return data.items.filter((m) => m.has_mom);
    }
    return data.items;
  }, [data, statusFilter]);

  // Keyboard Navigation & Interactive Waveform Row Hover
  const [activeRowIndex, setActiveRowIndex] = useState(-1);
  const [hoveredRowId, setHoveredRowId] = useState(null);

  useEffect(() => {
    function handleKeyDown(e) {
      if (["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName)) {
        return;
      }
      if (e.key === "/" && searchInputRef.current) {
        e.preventDefault();
        searchInputRef.current.focus();
        return;
      }
      if (!visibleItems.length) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveRowIndex((prev) => Math.min(prev + 1, visibleItems.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveRowIndex((prev) => Math.max(prev - 1, 0));
      } else if (activeRowIndex >= 0 && activeRowIndex < visibleItems.length) {
        const activeMeeting = visibleItems[activeRowIndex];
        if (e.key === "Enter" || e.key === "v" || e.key === "V") {
          e.preventDefault();
          onOpenMeeting(activeMeeting.meeting_id);
        } else if (e.key === "g" || e.key === "G") {
          if (activeMeeting.has_transcript && !activeMeeting.has_mom) {
            e.preventDefault();
            handleGenerateMom(activeMeeting);
          }
        } else if (e.key === "e" || e.key === "E") {
          e.preventDefault();
          const jsonStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(activeMeeting, null, 2));
          const dlAnchor = document.createElement("a");
          dlAnchor.setAttribute("href", jsonStr);
          dlAnchor.setAttribute("download", `Meeting_${activeMeeting.meeting_id}_Export.json`);
          dlAnchor.click();
          toast.success(`Exported metadata for ${activeMeeting.title || "meeting"}`);
        }
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [visibleItems, activeRowIndex, onOpenMeeting, toast]);

  function dismissCoachmark() {
    setShowCoachmark(false);
    localStorage.setItem("mom_coachmark_dismissed", "true");
  }

  // Row selection helpers
  const allSelected = visibleItems.length > 0 && visibleItems.every((item) => selectedIds.has(item.meeting_id));

  function toggleSelectAll() {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(visibleItems.map((i) => i.meeting_id)));
    }
  }

  function toggleSelectRow(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleDelete(id) {
    setDeletingId(id);
    try {
      await deleteMeeting(id);
      setConfirmId(null);
      toast.success("Meeting deleted from archive.");
      load();
    } catch (err) {
      toast.error(err.message || "Failed to delete meeting.");
    } finally {
      setDeletingId(null);
    }
  }

  async function handleBulkDelete() {
    if (selectedIds.size === 0) return;
    const count = selectedIds.size;
    try {
      for (const id of selectedIds) {
        await deleteMeeting(id);
      }
      setSelectedIds(new Set());
      toast.success(`Successfully deleted ${count} recording(s).`);
      load();
    } catch (err) {
      toast.error("Some meetings could not be deleted.");
      load();
    }
  }

  function handleBulkExport() {
    if (selectedIds.size === 0) return;
    const selectedMeetings = visibleItems.filter((i) => selectedIds.has(i.meeting_id));
    const jsonStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(selectedMeetings, null, 2));
    const dlAnchor = document.createElement("a");
    dlAnchor.setAttribute("href", jsonStr);
    dlAnchor.setAttribute("download", `Studio_Meetings_Export_${new Date().toISOString().slice(0, 10)}.json`);
    dlAnchor.click();
    toast.success(`Exported metadata for ${selectedMeetings.length} meeting(s).`);
  }

  async function handleRetry(meeting) {
    toast.info(`Retrying transcription for "${meeting.title || meeting.original_filename}"...`);
    try {
      await transcribeMeeting(meeting.meeting_id);
      toast.success("Transcription job restarted!");
      load();
    } catch (err) {
      toast.error(err.message || "Retry failed.");
    }
  }

  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState("");

  function startInlineRename(meeting, e) {
    if (e) e.stopPropagation();
    setRenameValue(meeting.title || meeting.original_filename || "");
    setRenamingId(meeting.meeting_id);
  }

  async function handleSaveInlineRename(meetingId, e) {
    if (e) e.preventDefault();
    const trimmed = renameValue.trim();
    if (!trimmed) {
      setRenamingId(null);
      return;
    }
    try {
      await renameMeeting(meetingId, trimmed);
      toast.success("Meeting renamed successfully.");
      setRenamingId(null);
      load();
    } catch (err) {
      toast.error(err.message || "Failed to rename meeting.");
    }
  }

  async function handleGenerateMom(meeting) {
    toast.info(`Extracting MOM for "${meeting.title || meeting.original_filename}"…`);
    try {
      await generateMom(meeting.meeting_id);
      toast.success("MOM generation started in background.");
      load();
    } catch (err) {
      toast.error(err.message || "Failed to generate MOM.");
    }
  }

  function toggleExpand(id) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handlePasswordSubmit(e) {
    e.preventDefault();
    setPwMsg(null);
    if (newPw !== confirmPw) {
      setPwMsg({ type: "err", text: "New passwords do not match." });
      return;
    }
    if (newPw.length < 8) {
      setPwMsg({ type: "err", text: "Password must be at least 8 characters long." });
      return;
    }
    setPwSubmitting(true);
    try {
      await changePassword(curPw, newPw);
      toast.success("Password changed successfully!");
      setShowPwModal(false);
      setCurPw("");
      setNewPw("");
      setConfirmPw("");
    } catch (err) {
      setPwMsg({ type: "err", text: err.message || "Password change failed." });
    } finally {
      setPwSubmitting(false);
    }
  }

  // Compute stat totals
  const totalCount = data?.total ?? 0;
  const completedCount = data?.stats?.completed ?? 0;
  const processingCount = data?.stats?.in_progress ?? data?.stats?.uploaded ?? 0;
  const failedCount = data?.stats?.failed ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  return (
    <div className="dashboard-root">
      {/* Console Top Bar */}
      <div className="console">
        <div className="console-inner">
          <div>
            <div className="brandline">
              <span className="rec-dot" />
              <span className="brand-text">Studio archive · Soundlab</span>
            </div>
            <h1 className="headline">Meeting Recordings & Intelligence</h1>
          </div>

          <div className="console-actions">
            <div className="coachmark-wrap">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  if (showCoachmark) dismissCoachmark();
                  onNewMeeting();
                }}
              >
                + New meeting
              </button>

              {/* First-Visit Onboarding Coachmark */}
              {showCoachmark && (
                <div className="coachmark-tooltip">
                  <p className="font-display text-sm text-ink font-semibold mb-1">
                    🎙️ Start your first recording
                  </p>
                  <p className="text-xs text-muted leading-relaxed mb-3">
                    Drag and drop audio files here to generate instant transcripts, speaker tags, and minutes of meeting.
                  </p>
                  <button
                    type="button"
                    className="text-[11px] font-mono text-accent hover:underline"
                    onClick={dismissCoachmark}
                  >
                    Got it, dismiss &times;
                  </button>
                </div>
              )}
            </div>

            <button
              type="button"
              className="btn btn-ghost btn-avatar"
              onClick={() => setShowProfileModal(true)}
              title="Open Studio Profile"
            >
              <span className="initials">
                {headerAvatar ? (
                  <img src={headerAvatar} alt="Profile" />
                ) : (
                  (user?.username?.[0] || "U").toUpperCase()
                )}
              </span>
              <span>{user?.username || "Studio User"}</span>
            </button>
          </div>
        </div>
      </div>

      <div className="wrap">
        {/* Meter Stats Cards */}
        <div className="deck">
          <div className="meter-card">
            <div className="tag">
              <span>Total Archive</span>
              <span>CH 01</span>
            </div>
            <div className="val">{totalCount}</div>
            <div className="sub">Recorded sessions</div>
            <div className="ticks">
              <i className="active" style={{ height: "30%" }} />
              <i className="active" style={{ height: "60%" }} />
              <i className="active" style={{ height: "80%" }} />
              <i className="active" style={{ height: "50%" }} />
              <i className="active" style={{ height: "90%" }} />
            </div>
          </div>

          <div className="meter-card">
            <div className="tag">
              <span>MOM Ready</span>
              <span>CH 02</span>
            </div>
            <div className="val">{completedCount}</div>
            <div className="sub">Transcribed & synthesized</div>
            <div className="ticks">
              <i className="active" style={{ height: "40%" }} />
              <i className="active" style={{ height: "70%" }} />
              <i className="active" style={{ height: "95%" }} />
              <i className="active" style={{ height: "60%" }} />
              <i className="active" style={{ height: "100%" }} />
            </div>
          </div>

          <div className="meter-card">
            <div className="tag">
              <span>In Pipeline</span>
              <span>CH 03</span>
            </div>
            <div className="val text-amber">{processingCount}</div>
            <div className="sub">Whisper / AI processing</div>
            <div className="ticks">
              <i className="amber" style={{ height: "50%" }} />
              <i className="amber" style={{ height: "75%" }} />
              <i className="amber" style={{ height: "40%" }} />
              <i className="amber" style={{ height: "85%" }} />
              <i className="amber" style={{ height: "30%" }} />
            </div>
          </div>

          <div className="meter-card">
            <div className="tag">
              <span>Failed Logs</span>
              <span>CH 04</span>
            </div>
            <div className="val text-brick">{failedCount}</div>
            <div className="sub">Needs retry</div>
            <div className="ticks">
              <i className={failedCount > 0 ? "brick" : ""} style={{ height: "20%" }} />
              <i className={failedCount > 0 ? "brick" : ""} style={{ height: "35%" }} />
              <i className={failedCount > 0 ? "brick" : ""} style={{ height: "15%" }} />
              <i className={failedCount > 0 ? "brick" : ""} style={{ height: "45%" }} />
              <i className={failedCount > 0 ? "brick" : ""} style={{ height: "20%" }} />
            </div>
          </div>
        </div>

        {/* Sub-tabs: My Meetings vs Team */}
        <div className="dashboard-subtabs">
          <button
            type="button"
            className={`subtab-btn ${subTab === "my" ? "active" : ""}`}
            onClick={() => setSubTab("my")}
          >
            My Meetings ({totalCount})
          </button>
          <button
            type="button"
            className={`subtab-btn ${subTab === "team" ? "active" : ""}`}
            onClick={() => setSubTab("team")}
          >
            Team & Shared (4)
          </button>
        </div>

        {/* Toolbar: Search, Shortcuts, Filter, Sort */}
        <div className="toolbar">
          <div className="search-wrap">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              ref={searchInputRef}
              type="text"
              className="search-input"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(1);
              }}
              placeholder="Search recordings by title, file, or transcript…"
            />
            <span className="search-shortcut-kbd">/</span>
          </div>

          <div className="filters">
            <select
              className="select"
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All Statuses</option>
              <option value="completed">Completed (MOM Ready)</option>
              <option value="transcribed">Transcribed</option>
              <option value="in_progress">Processing</option>
              <option value="failed">Failed Logs</option>
              <option value="has_actions">Has Open Action Items</option>
            </select>

            <select
              className="select"
              value={sortOrder}
              onChange={(e) => {
                setSortOrder(e.target.value);
                setPage(1);
              }}
            >
              <option value="newest">Newest First</option>
              <option value="oldest">Oldest First</option>
              <option value="title_asc">Title A–Z</option>
              <option value="title_desc">Title Z–A</option>
            </select>

            {/* Quick Keyboard Shortcuts Legend */}
            <div className="hidden xl:flex items-center gap-2 text-[11px] font-mono text-slate-500 pl-2 border-l border-slate-200/80">
              <span className="flex items-center gap-1"><kbd className="px-1.5 py-0.5 rounded bg-white/90 border border-slate-200 text-slate-700 shadow-xs">↑↓</kbd> Select</span>
              <span className="flex items-center gap-1"><kbd className="px-1.5 py-0.5 rounded bg-white/90 border border-slate-200 text-slate-700 shadow-xs">↵</kbd> View</span>
              <span className="flex items-center gap-1"><kbd className="px-1.5 py-0.5 rounded bg-white/90 border border-slate-200 text-slate-700 shadow-xs">G</kbd> MOM</span>
              <span className="flex items-center gap-1"><kbd className="px-1.5 py-0.5 rounded bg-white/90 border border-slate-200 text-slate-700 shadow-xs">E</kbd> Export</span>
            </div>
          </div>
        </div>

        {/* Floating Bulk Actions Bar */}
        {selectedIds.size > 0 && (
          <div className="bulk-bar">
            <div className="bulk-bar-left">
              <span className="font-mono font-semibold text-accent">{selectedIds.size}</span>
              <span>meeting(s) selected</span>
            </div>
            <div className="bulk-bar-actions">
              <button
                type="button"
                className="btn btn-ghost text-xs"
                style={{ padding: "6px 12px" }}
                onClick={handleBulkExport}
              >
                Export JSON
              </button>
              <button
                type="button"
                className="btn text-xs bg-[rgba(217,105,79,0.2)] text-danger border border-[rgba(217,105,79,0.3)] hover:bg-[rgba(217,105,79,0.3)]"
                style={{ padding: "6px 12px" }}
                onClick={handleBulkDelete}
              >
                Delete Selected
              </button>
              <button
                type="button"
                className="text-xs font-mono text-muted hover:text-ink px-2"
                onClick={() => setSelectedIds(new Set())}
              >
                Clear
              </button>
            </div>
          </div>
        )}

        {/* Archive Table */}
        <div className="table-card">
          <div className="table-head">
            <span>
              <input
                type="checkbox"
                className="row-checkbox"
                checked={allSelected}
                onChange={toggleSelectAll}
                title="Select all on page"
              />
            </span>
            <span>Recording Title</span>
            <span>Signal</span>
            <span>Status</span>
            <span>Recorded</span>
            <span style={{ textAlign: "right" }}>Actions</span>
          </div>

          <div className="table-body">
            {loading ? (
              <SkeletonRows count={pageSize} />
            ) : error ? (
              <div className="p-8 text-center text-danger text-sm">{error}</div>
            ) : visibleItems.length === 0 ? (
              <EmptyStateArtwork
                title="No meetings found"
                description={
                  q || statusFilter
                    ? "No recordings match your current search and filter criteria."
                    : "Your studio archive is empty. Start your first recording now."
                }
                actionText="+ Start new recording"
                onAction={onNewMeeting}
              />
            ) : (
              visibleItems.map((meeting, index) => {
                const isSelected = selectedIds.has(meeting.meeting_id);
                const isExpanded = expandedIds.has(meeting.meeting_id);
                const isDeleting = deletingId === meeting.meeting_id;
                const isConfirming = confirmId === meeting.meeting_id;
                const isHovered = hoveredRowId === meeting.meeting_id;
                const isKeyboardActive = activeRowIndex === index;

                return (
                  <div key={meeting.meeting_id}>
                    <div
                      className={`row transition-all duration-150 ${isKeyboardActive ? "ring-2 ring-indigo-500/50 bg-indigo-50/40 rounded-xl" : ""}`}
                      onMouseEnter={() => setHoveredRowId(meeting.meeting_id)}
                      onMouseLeave={() => setHoveredRowId(null)}
                      onClick={() => setActiveRowIndex(index)}
                    >
                      {/* Row Checkbox */}
                      <div>
                        <input
                          type="checkbox"
                          className="row-checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelectRow(meeting.meeting_id)}
                        />
                      </div>

                      {/* Title & File */}
                      {renamingId === meeting.meeting_id ? (
                        <form
                          onSubmit={(e) => handleSaveInlineRename(meeting.meeting_id, e)}
                          onClick={(e) => e.stopPropagation()}
                          className="flex flex-row items-center gap-1.5 min-w-0"
                        >
                          <input
                            type="text"
                            autoFocus
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Escape") setRenamingId(null);
                            }}
                            className="rounded-lg border border-blue-500 bg-white px-2.5 py-1 text-xs font-semibold text-slate-900 shadow-sm focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-100 min-w-[140px] max-w-[220px]"
                          />
                          <button
                            type="submit"
                            className="shrink-0 rounded-lg bg-blue-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-blue-700 shadow-sm transition-all"
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setRenamingId(null);
                            }}
                            className="shrink-0 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 transition-all"
                          >
                            ✕
                          </button>
                        </form>
                      ) : (
                        <div
                          className="cell-title group"
                          onClick={() => onOpenMeeting(meeting.meeting_id)}
                          onDoubleClick={(e) => startInlineRename(meeting, e)}
                          title="Click to view · Double-click to rename"
                        >
                          <div className="flex items-center gap-1.5">
                            <span className="title">
                              {meeting.title || meeting.original_filename || "Untitled meeting"}
                            </span>
                            <button
                              type="button"
                              onClick={(e) => startInlineRename(meeting, e)}
                              className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 text-slate-400 hover:text-blue-600"
                              title="Rename meeting"
                            >
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M12 20h9" />
                                <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                              </svg>
                            </button>
                          </div>
                          <span className="file font-mono">{meeting.original_filename}</span>
                        </div>
                      )}

                      {/* Interactive Waveform Signal */}
                      <div className="wave">
                        <InteractiveWaveform
                          status={meeting.status}
                          isHovered={isHovered}
                          id={meeting.meeting_id}
                        />
                      </div>

                      {/* Status Badge + Failed Retry Action */}
                      <div className="flex items-center gap-2">
                        <span className={`badge ${statusClass(meeting.status)}`}>
                          <span className="badge-dot" />
                          {statusLabel(meeting.status)}
                        </span>
                        {meeting.status === "failed" && (
                          <button
                            type="button"
                            className="retry-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRetry(meeting);
                            }}
                            title="Audio processing timed out or failed. Click to retry."
                          >
                            Retry ↻
                          </button>
                        )}
                      </div>

                      {/* Recorded Date */}
                      <div className="cell-date">{fmtDate(meeting.created_at)}</div>

                      {/* Row Actions */}
                      <div className="cell-actions">
                        {meeting.has_transcript && !meeting.has_mom && (
                          <button
                            type="button"
                            className="action-link font-semibold text-blue-600 hover:text-blue-700"
                            onClick={() => handleGenerateMom(meeting)}
                          >
                            ✨ Generate MOM
                          </button>
                        )}

                        <button
                          type="button"
                          className="action-link"
                          onClick={() => toggleExpand(meeting.meeting_id)}
                        >
                          {isExpanded ? "Hide" : "Preview"}
                        </button>

                        <button
                          type="button"
                          className="action-link"
                          onClick={() => onOpenMeeting(meeting.meeting_id)}
                        >
                          Open &rarr;
                        </button>

                        {isConfirming ? (
                          <span className="pill-confirm">
                            <button
                              type="button"
                              className="pill-btn confirm"
                              disabled={isDeleting}
                              onClick={() => handleDelete(meeting.meeting_id)}
                            >
                              {isDeleting ? "…" : "Confirm"}
                            </button>
                            <button
                              type="button"
                              className="pill-btn cancel"
                              onClick={() => setConfirmId(null)}
                            >
                              ✕
                            </button>
                          </span>
                        ) : (
                          <button
                            type="button"
                            className="action-link danger"
                            onClick={() => setConfirmId(meeting.meeting_id)}
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Inline Expand Row */}
                    {isExpanded && (
                      <div className="expanded-row">
                        <div className="expanded-section">
                          <div className="expanded-label">Meeting Overview & Summary</div>
                          <p className="expanded-summary">
                            {meeting.summary || "No synthesized summary available for this meeting yet."}
                          </p>
                        </div>
                        <div className="w-56 shrink-0 font-mono text-xs text-muted border-l border-line pl-5 space-y-1.5">
                          <div>
                            <span className="text-faint uppercase">Diarized:</span>{" "}
                            <span className="text-ink">{meeting.has_diarization ? "Yes (Multi-speaker)" : "Standard"}</span>
                          </div>
                          <div>
                            <span className="text-faint uppercase">Language:</span>{" "}
                            <span className="text-ink">{meeting.detected_language || "Auto"}</span>
                          </div>
                          <div>
                            <span className="text-faint uppercase">Action items:</span>{" "}
                            <span className="text-ink">{meeting.has_mom ? "Available in MOM" : "None"}</span>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {/* Enhanced Pagination Controls */}
          <div className="pagination">
            <div className="flex items-center gap-3">
              <span>
                Page {page} of {totalPages} ({totalCount} total recordings)
              </span>
              <select
                className="select py-1 px-2 text-xs font-mono"
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setPage(1);
                }}
              >
                <option value={10}>10 per page</option>
                <option value={20}>20 per page</option>
                <option value={50}>50 per page</option>
              </select>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                className="page-btn"
                disabled={page <= 1}
                onClick={() => setPage(1)}
              >
                ⇤ First
              </button>
              <button
                type="button"
                className="page-btn"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                ← Prev
              </button>
              <button
                type="button"
                className="page-btn"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                Next →
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Profile Card Modal */}
      {showProfileModal && (
        <ProfileCard
          user={user}
          stats={{
            total: totalCount,
            completed: completedCount,
          }}
          onChangePassword={() => setShowPwModal(true)}
          onSignOut={logout}
          onClose={() => setShowProfileModal(false)}
        />
      )}

      {/* Change Password Modal */}
      {showPwModal && (
        <div className="new-meeting-overlay" onClick={() => setShowPwModal(false)}>
          <div className="new-meeting-modal" onClick={(e) => e.stopPropagation()}>
            <div className="new-meeting-header">
              <div>
                <h3 className="new-meeting-title">Change Password</h3>
                <p className="new-meeting-sub">Ensure your Studio account remains protected.</p>
              </div>
              <button
                type="button"
                className="text-muted hover:text-ink text-lg p-1"
                onClick={() => setShowPwModal(false)}
              >
                &times;
              </button>
            </div>

            <form onSubmit={handlePasswordSubmit} className="new-meeting-body">
              {pwMsg && (
                <div
                  className={`mb-4 rounded-lg px-3.5 py-2.5 text-xs font-mono ${
                    pwMsg.type === "err"
                      ? "bg-[rgba(217,105,79,0.15)] text-danger border border-[rgba(217,105,79,0.3)]"
                      : "bg-[rgba(79,169,140,0.15)] text-accent border border-[rgba(79,169,140,0.3)]"
                  }`}
                >
                  {pwMsg.text}
                </div>
              )}

              <div className="new-meeting-field">
                <label>Current Password</label>
                <input
                  type="password"
                  required
                  className="new-meeting-input"
                  value={curPw}
                  onChange={(e) => setCurPw(e.target.value)}
                />
              </div>

              <div className="new-meeting-field">
                <label>New Password</label>
                <input
                  type="password"
                  required
                  minLength={8}
                  className="new-meeting-input"
                  value={newPw}
                  onChange={(e) => setNewPw(e.target.value)}
                />
              </div>

              <div className="new-meeting-field">
                <label>Confirm New Password</label>
                <input
                  type="password"
                  required
                  minLength={8}
                  className="new-meeting-input"
                  value={confirmPw}
                  onChange={(e) => setConfirmPw(e.target.value)}
                />
              </div>

              <div className="new-meeting-actions">
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setShowPwModal(false)}
                  disabled={pwSubmitting}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={pwSubmitting}
                >
                  {pwSubmitting ? "Updating…" : "Update Password"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
