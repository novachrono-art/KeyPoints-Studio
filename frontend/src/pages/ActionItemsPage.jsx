/**
 * ActionItemsPage.jsx - Dedicated Action Items View
 */

import { useState, useEffect, useMemo } from "react";
import { listMeetings, getMom, updateActionItemStatus } from "../services/api.js";
import { useToast } from "../context/ToastContext.jsx";
import EmptyStateArtwork from "../components/EmptyStateArtwork.jsx";
import "./ActionItemsPage.css";

export default function ActionItemsPage({ onOpenMeeting }) {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [rawActionItems, setRawActionItems] = useState([]);
  const [completedMap, setCompletedMap] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("mom_completed_action_items") || "{}");
    } catch {
      return {};
    }
  });

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("open"); // "all" | "open" | "completed" | "high"

  useEffect(() => {
    async function loadAllActionItems() {
      setLoading(true);
      try {
        const res = await listMeetings({ pageSize: 50 });
        const meetingsWithMom = res.items.filter((m) => m.has_mom);

        const itemsList = [];
        for (const m of meetingsWithMom) {
          try {
            const momData = await getMom(m.meeting_id);
            if (Array.isArray(momData.action_items)) {
              momData.action_items.forEach((item, idx) => {
                const uniqueKey = `${m.meeting_id}_${idx}_${(item.task || "").slice(0, 15)}`;
                itemsList.push({
                  ...item,
                  itemIndex: idx,
                  uniqueKey,
                  meetingId: m.meeting_id,
                  meetingTitle: m.title || "Untitled meeting",
                });
              });
            }
          } catch {
            // continue
          }
        }
        setRawActionItems(itemsList);
      } catch {
        toast.error("Unable to load action items.");
      } finally {
        setLoading(false);
      }
    }
    loadAllActionItems();
  }, [toast]);

  async function toggleComplete(item) {
    const isCurrentlyDone = item.status === "done" || Boolean(completedMap[item.uniqueKey]);
    const newStatus = isCurrentlyDone ? "pending" : "done";

    setRawActionItems((prev) =>
      prev.map((i) => (i.uniqueKey === item.uniqueKey ? { ...i, status: newStatus } : i))
    );
    setCompletedMap((prev) => {
      const next = { ...prev, [item.uniqueKey]: newStatus === "done" };
      localStorage.setItem("mom_completed_action_items", JSON.stringify(next));
      return next;
    });

    toast.info(newStatus === "done" ? "Action item completed" : "Action item re-opened");

    try {
      await updateActionItemStatus(item.meetingId, item.itemIndex, newStatus);
    } catch {
      toast.error("Could not persist status to database.");
    }
  }

  const filteredItems = useMemo(() => {
    return rawActionItems.filter((item) => {
      const isDone = Boolean(completedMap[item.uniqueKey] || item.status === "done");
      const matchSearch =
        (item.task || "").toLowerCase().includes(search.toLowerCase()) ||
        (item.assignee || "").toLowerCase().includes(search.toLowerCase()) ||
        item.meetingTitle.toLowerCase().includes(search.toLowerCase());

      if (!matchSearch) return false;

      if (filter === "open") return !isDone;
      if (filter === "completed") return isDone;
      if (filter === "high") return item.priority === "high";
      return true;
    });
  }, [rawActionItems, completedMap, search, filter]);

  const [displayMode, setDisplayMode] = useState("table"); // "table" | "kanban"

  function exportCSV() {
    if (filteredItems.length === 0) return;
    const headers = ["Task", "Assignee", "Deadline", "Priority", "Status", "Meeting"];
    const rows = filteredItems.map((i) => [
      `"${(i.task || "").replace(/"/g, '""')}"`,
      `"${(i.assignee || "").replace(/"/g, '""')}"`,
      `"${i.deadline || ""}"`,
      `"${i.priority || ""}"`,
      `"${completedMap[i.uniqueKey] ? "done" : i.status || "open"}"`,
      `"${(i.meetingTitle || "").replace(/"/g, '""')}"`,
    ]);

    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const link = document.createElement("a");
    link.href = encodeURI(csvContent);
    link.download = `Action_Items_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    toast.success("Action items exported to CSV");
  }

  const openCount = rawActionItems.filter((i) => !completedMap[i.uniqueKey] && i.status !== "done").length;

  // Kanban Columns Data
  const kanbanColumns = useMemo(() => {
    return [
      {
        id: "pending",
        title: "Pending",
        color: "bg-slate-500",
        items: filteredItems.filter((i) => !completedMap[i.uniqueKey] && (i.status === "pending" || !i.status)),
      },
      {
        id: "in_progress",
        title: "In Progress",
        color: "bg-indigo-500",
        items: filteredItems.filter((i) => !completedMap[i.uniqueKey] && i.status === "in_progress"),
      },
      {
        id: "blocked",
        title: "Blocked",
        color: "bg-rose-500",
        items: filteredItems.filter((i) => !completedMap[i.uniqueKey] && i.status === "blocked"),
      },
      {
        id: "done",
        title: "Completed",
        color: "bg-emerald-500",
        items: filteredItems.filter((i) => Boolean(completedMap[i.uniqueKey] || i.status === "done")),
      },
    ];
  }, [filteredItems, completedMap]);

  return (
    <div className="action-page-root">
      <div className="action-page-wrap">
        <div className="action-page-header">
          <div>
            <h1 className="action-page-title">Action Items & Deliverables</h1>
            <p className="action-page-sub">
              {openCount} open action item(s) across {rawActionItems.length} total recorded items.
            </p>
          </div>

          <div className="flex items-center gap-3">
            {/* Table / Kanban View Toggle */}
            <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-200/60 border border-white/80 backdrop-blur-md text-xs font-medium">
              <button
                type="button"
                className={`px-3 py-1.5 rounded-lg transition-all ${
                  displayMode === "table"
                    ? "bg-white text-indigo-700 font-semibold shadow-xs"
                    : "text-slate-600 hover:text-slate-900"
                }`}
                onClick={() => setDisplayMode("table")}
              >
                ▤ Table
              </button>
              <button
                type="button"
                className={`px-3 py-1.5 rounded-lg transition-all ${
                  displayMode === "kanban"
                    ? "bg-white text-indigo-700 font-semibold shadow-xs"
                    : "text-slate-600 hover:text-slate-900"
                }`}
                onClick={() => setDisplayMode("kanban")}
              >
                ▦ Kanban
              </button>
            </div>

            <button
              type="button"
              className="btn btn-ghost text-xs"
              onClick={exportCSV}
              disabled={filteredItems.length === 0}
            >
              Export CSV
            </button>
          </div>
        </div>

        {/* Toolbar */}
        <div className="action-page-toolbar">
          <div className="action-search-wrap">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              className="action-search-input"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search tasks, assignees, or meetings…"
            />
          </div>

          <button
            type="button"
            className={`action-filter-btn ${filter === "open" ? "active" : ""}`}
            onClick={() => setFilter("open")}
          >
            Open ({openCount})
          </button>
          <button
            type="button"
            className={`action-filter-btn ${filter === "all" ? "active" : ""}`}
            onClick={() => setFilter("all")}
          >
            All ({rawActionItems.length})
          </button>
          <button
            type="button"
            className={`action-filter-btn ${filter === "high" ? "active" : ""}`}
            onClick={() => setFilter("high")}
          >
            High Priority
          </button>
          <button
            type="button"
            className={`action-filter-btn ${filter === "completed" ? "active" : ""}`}
            onClick={() => setFilter("completed")}
          >
            Completed
          </button>
        </div>

        {/* Display Mode Switcher */}
        {loading ? (
          <div className="py-20 text-center text-muted">Loading action items…</div>
        ) : filteredItems.length === 0 ? (
          <EmptyStateArtwork
            title="No action items match"
            description="No tasks found matching your active filter or search query."
            actionText="View all items"
            onAction={() => {
              setFilter("all");
              setSearch("");
            }}
          />
        ) : displayMode === "table" ? (
          /* ==================== DENSE TABLE VIEW ==================== */
          <div className="action-table-card">
            <div>
              {filteredItems.map((item) => {
                const isDone = Boolean(completedMap[item.uniqueKey] || item.status === "done");
                const assigneeInitial = (item.assignee?.[0] || "?").toUpperCase();

                return (
                  <div
                    key={item.uniqueKey}
                    className={`action-item-row transition-all duration-150 ${isDone ? "completed opacity-60 bg-slate-50/50" : ""}`}
                  >
                    <div>
                      <input
                        type="checkbox"
                        className="action-checkbox"
                        checked={isDone}
                        onChange={() => toggleComplete(item)}
                        title="Mark as complete"
                      />
                    </div>

                    <div className={`action-task-text transition-all ${isDone ? "line-through text-slate-400" : "text-slate-800"}`}>
                      {item.task || "Unspecified task"}
                    </div>

                    <div className="action-assignee">
                      {item.assignee ? (
                        <>
                          <span className="action-assignee-avatar">
                            {assigneeInitial}
                          </span>
                          <span className="truncate max-w-[120px] font-medium">{item.assignee}</span>
                        </>
                      ) : (
                        <span className="text-muted italic text-xs">—</span>
                      )}
                    </div>

                    <div className="font-mono text-xs text-muted">
                      {item.deadline || "—"}
                    </div>

                    <div>
                      {item.priority ? (
                        <span className={`action-priority-badge ${item.priority.toLowerCase()}`}>
                          {item.priority}
                        </span>
                      ) : (
                        <span className="text-muted font-mono text-xs">—</span>
                      )}
                    </div>

                    <div className="truncate">
                      <span
                        className="action-meeting-link truncate block"
                        onClick={() => onOpenMeeting(item.meetingId)}
                        title={`Open ${item.meetingTitle}`}
                      >
                        📁 {item.meetingTitle}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          /* ==================== KANBAN BOARD VIEW ==================== */
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 items-start">
            {kanbanColumns.map((col) => (
              <div key={col.id} className="rounded-2xl border border-white/80 bg-white/70 p-4 shadow-sm backdrop-blur-xl flex flex-col min-h-[420px]">
                {/* Column Header */}
                <div className="flex items-center justify-between pb-3 border-b border-slate-200/70 mb-3">
                  <div className="flex items-center gap-2">
                    <span className={`h-2.5 w-2.5 rounded-full ${col.color}`} />
                    <span className="font-display text-sm font-semibold text-slate-800">{col.title}</span>
                  </div>
                  <span className="text-xs font-mono font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                    {col.items.length}
                  </span>
                </div>

                {/* Cards List */}
                <div className="space-y-2.5 flex-1 overflow-y-auto max-h-[600px] pr-0.5">
                  {col.items.length === 0 ? (
                    <div className="p-8 text-center text-xs text-slate-400 italic">No tasks</div>
                  ) : (
                    col.items.map((item) => {
                      const isDone = Boolean(completedMap[item.uniqueKey] || item.status === "done");
                      return (
                        <div
                          key={item.uniqueKey}
                          className="rounded-xl border border-slate-200/80 bg-white/90 p-3.5 shadow-xs hover:shadow-md hover:-translate-y-0.5 transition-all"
                        >
                          <div className="flex items-start gap-2.5">
                            <input
                              type="checkbox"
                              checked={isDone}
                              onChange={() => toggleComplete(item)}
                              className="action-checkbox mt-0.5 shrink-0"
                            />
                            <div className="flex-1 min-w-0">
                              <p className={`text-xs font-medium leading-snug ${isDone ? "line-through text-slate-400" : "text-slate-800"}`}>
                                {item.task || "Unspecified task"}
                              </p>

                              <div className="mt-2.5 flex flex-wrap items-center gap-2 text-[11px]">
                                {item.priority && (
                                  <span className={`action-priority-badge text-[10px] px-2 py-0.5 ${item.priority.toLowerCase()}`}>
                                    {item.priority}
                                  </span>
                                )}
                                {item.assignee && (
                                  <span className="font-medium text-slate-600 bg-slate-100 px-2 py-0.5 rounded-md">
                                    👤 {item.assignee}
                                  </span>
                                )}
                              </div>

                              <div className="mt-2 pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
                                <span
                                  className="truncate hover:text-indigo-600 cursor-pointer max-w-[140px]"
                                  onClick={() => onOpenMeeting(item.meetingId)}
                                  title={item.meetingTitle}
                                >
                                  📁 {item.meetingTitle}
                                </span>
                                {item.deadline && <span className="font-mono text-[10px]">{item.deadline}</span>}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
