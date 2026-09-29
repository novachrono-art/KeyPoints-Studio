/**
 * CommandPalette.jsx - Studio Command Palette (⌘K / Ctrl+K)
 * Raycast-style launcher with category grouping, keyboard navigation, and preview pane.
 */

import { useState, useEffect, useRef } from "react";
import "./CommandPalette.css";

export default function CommandPalette({
  isOpen,
  onClose,
  onNavigate,
  onNewMeeting,
  onOpenProfile,
  onOpenPassword,
  onLogout,
}) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef(null);

  const actions = [
    {
      id: "new-meeting",
      group: "Actions",
      title: "Start new recording / upload",
      description: "Upload an audio or video file to generate a transcript and structured MOM.",
      shortcut: "N",
      icon: "🎙️",
      run: () => onNewMeeting(),
    },
    {
      id: "view-meetings",
      group: "Navigation",
      title: "Go to Meetings Dashboard",
      description: "Browse, filter, and manage all your meeting recordings and generated minutes.",
      shortcut: "G M",
      icon: "📁",
      run: () => onNavigate("dashboard"),
    },
    {
      id: "view-actions",
      group: "Navigation",
      title: "Go to Action Items",
      description: "Track, filter, and complete action items across all recorded meetings.",
      shortcut: "G A",
      icon: "✓",
      run: () => onNavigate("action-items"),
    },
    {
      id: "view-team",
      group: "Navigation",
      title: "Go to Team Workspace",
      description: "Manage team members, permissions, and workspace invitations.",
      shortcut: "G T",
      icon: "👥",
      run: () => onNavigate("team"),
    },
    {
      id: "view-settings",
      group: "Navigation",
      title: "Open Workspace Settings",
      description: "Configure language defaults, diarization, Slack webhook, and third-party integrations.",
      shortcut: "G S",
      icon: "⚙️",
      run: () => onNavigate("settings"),
    },
    {
      id: "open-profile",
      group: "Account",
      title: "View Studio Profile Card",
      description: "View account credentials, display name, and avatar settings.",
      shortcut: "P",
      icon: "👤",
      run: () => onOpenProfile(),
    },
    {
      id: "change-password",
      group: "Account",
      title: "Change Account Password",
      description: "Update your account security password with instant validation.",
      shortcut: "C P",
      icon: "🔑",
      run: () => onOpenPassword(),
    },
    {
      id: "logout",
      group: "Account",
      title: "Sign out of Studio",
      description: "Safely end your current authenticated session.",
      shortcut: "Q",
      icon: "🚪",
      run: () => onLogout(),
    },
  ];

  const filtered = actions.filter((a) =>
    a.title.toLowerCase().includes(query.toLowerCase()) ||
    a.group.toLowerCase().includes(query.toLowerCase()) ||
    (a.description && a.description.toLowerCase().includes(query.toLowerCase()))
  );

  useEffect(() => {
    if (isOpen) {
      setQuery("");
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 40);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const activeItem = filtered[selectedIndex] || filtered[0] || null;

  function handleKeyDown(e) {
    if (e.key === "Escape") {
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % (filtered.length || 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + filtered.length) % (filtered.length || 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (filtered[selectedIndex]) {
        filtered[selectedIndex].run();
        onClose();
      }
    }
  }

  return (
    <div className="cmd-overlay" onClick={onClose}>
      <div className="cmd-modal" onClick={(e) => e.stopPropagation()}>
        {/* Search header */}
        <div className="cmd-search-wrap">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted shrink-0">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            className="cmd-input"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={handleKeyDown}
            placeholder="Type a command or search actions..."
          />
          <kbd className="cmd-item-shortcut">ESC</kbd>
        </div>

        {/* Raycast split body: List (left) + Preview Pane (right) */}
        <div className="cmd-body-split">
          <div className="cmd-list">
            {filtered.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted">
                No commands found for "{query}"
              </div>
            ) : (
              filtered.map((item, idx) => (
                <div
                  key={item.id}
                  className={`cmd-item ${idx === selectedIndex ? "selected" : ""}`}
                  onClick={() => {
                    item.run();
                    onClose();
                  }}
                  onMouseEnter={() => setSelectedIndex(idx)}
                >
                  <div className="cmd-item-left">
                    <span className="cmd-item-icon">{item.icon}</span>
                    <div className="min-w-0">
                      <div className="cmd-item-title truncate">{item.title}</div>
                      <span className="text-[11px] font-mono text-muted">{item.group}</span>
                    </div>
                  </div>
                  {item.shortcut && (
                    <span className="cmd-item-shortcut">{item.shortcut}</span>
                  )}
                </div>
              ))
            )}
          </div>

          {/* Right Preview Pane */}
          {activeItem && (
            <div className="cmd-preview-pane hidden md:flex">
              <div className="cmd-preview-icon">{activeItem.icon}</div>
              <h4 className="cmd-preview-title">{activeItem.title}</h4>
              <p className="cmd-preview-desc">{activeItem.description}</p>
              
              <div className="cmd-preview-meta">
                <div className="cmd-meta-row">
                  <span className="text-muted text-xs">Section</span>
                  <span className="font-semibold text-xs text-ink">{activeItem.group}</span>
                </div>
                {activeItem.shortcut && (
                  <div className="cmd-meta-row">
                    <span className="text-muted text-xs">Shortcut</span>
                    <kbd className="cmd-item-shortcut">{activeItem.shortcut}</kbd>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="cmd-footer">
          <div className="flex items-center gap-3">
            <span>Navigate <kbd>↑</kbd> <kbd>↓</kbd></span>
            <span>Execute <kbd>↵</kbd></span>
          </div>
          <span className="font-mono text-[11px] text-muted">KeyPoints Raycast Launcher</span>
        </div>
      </div>
    </div>
  );
}
