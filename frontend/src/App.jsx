/**
 * App.jsx - Main Application Router & Studio Context Provider
 */

import { useState, useEffect } from "react";
import { AuthProvider, useAuth } from "./context/AuthContext.jsx";
import { ThemeProvider, useTheme } from "./context/ThemeContext.jsx";
import { ToastProvider, useToast } from "./context/ToastContext.jsx";
import AuthPage from "./pages/AuthPage.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import MeetingDetail from "./pages/MeetingDetail.jsx";
import HomePage from "./pages/HomePage.jsx";
import ActionItemsPage from "./pages/ActionItemsPage.jsx";
import TeamPage from "./pages/TeamPage.jsx";
import SettingsPage from "./pages/SettingsPage.jsx";
import StudioNav from "./components/StudioNav.jsx";
import CommandPalette from "./components/CommandPalette.jsx";
import NewMeetingModal from "./components/NewMeetingModal.jsx";
import ProfileCard from "./components/ProfileCard.jsx";

function AppContent() {
  const { user, loading, logout } = useAuth();
  const toast = useToast();

  // view: "dashboard" | "action-items" | "team" | "settings" | "new" | "detail:{meetingId}"
  const [view, setView] = useState("dashboard");

  // Global Modals State
  const [isCmdOpen, setIsCmdOpen] = useState(false);
  const [isNewMeetingModalOpen, setIsNewMeetingModalOpen] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);

  // Global Keyboard listener for Command Palette (⌘K / Ctrl+K)
  useEffect(() => {
    function handleKeyDown(e) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setIsCmdOpen((prev) => !prev);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="h-9 w-9 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600 shadow-lg shadow-blue-500/20" />
      </div>
    );
  }

  // Not authenticated
  if (!user) {
    return <AuthPage />;
  }

  const meetingId = view.startsWith("detail:")
    ? view.slice("detail:".length)
    : null;

  function handleNavigate(targetView) {
    setView(targetView);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <div className="relative" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', color: '#0F172A' }}>
      {/* Subtle fixed ambient luminous mesh orbs */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden z-0">
        <div className="absolute -top-40 -right-40 w-[600px] h-[600px] bg-blue-400/15 rounded-full blur-3xl" />
        <div className="absolute top-1/3 -left-40 w-[500px] h-[500px] bg-indigo-300/15 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 right-1/4 w-[600px] h-[600px] bg-sky-300/20 rounded-full blur-3xl" />
      </div>

      {/* Global Studio Top Navigation */}
      <StudioNav
        activeTab={view}
        onTabChange={handleNavigate}
        onOpenCommandPalette={() => setIsCmdOpen(true)}
        onOpenProfile={() => setIsProfileOpen(true)}
        onNewMeeting={() => setIsNewMeetingModalOpen(true)}
        user={user}
      />

      {/* Main View Router */}
      <main className="flex-1 relative z-10">
        {meetingId ? (
          <MeetingDetail
            meetingId={meetingId}
            onBack={() => handleNavigate("dashboard")}
          />
        ) : view === "new" ? (
          <HomePage onDone={() => handleNavigate("dashboard")} />
        ) : view === "action-items" ? (
          <ActionItemsPage
            onOpenMeeting={(id) => handleNavigate(`detail:${id}`)}
          />
        ) : view === "team" ? (
          <TeamPage user={user} />
        ) : view === "settings" ? (
          <SettingsPage />
        ) : (
          <Dashboard
            onOpenMeeting={(id) => handleNavigate(`detail:${id}`)}
            onNewMeeting={() => setIsNewMeetingModalOpen(true)}
            onOpenActionItems={() => handleNavigate("action-items")}
          />
        )}
      </main>

      {/* Global Command Palette */}
      <CommandPalette
        isOpen={isCmdOpen}
        onClose={() => setIsCmdOpen(false)}
        onNavigate={handleNavigate}
        onNewMeeting={() => {
          setIsCmdOpen(false);
          setIsNewMeetingModalOpen(true);
        }}
        onOpenProfile={() => {
          setIsCmdOpen(false);
          setIsProfileOpen(true);
        }}
        onOpenPassword={() => {
          setIsCmdOpen(false);
          setIsProfileOpen(true);
        }}
        onLogout={logout}
      />

      {/* Global New Meeting Drag-and-Drop Modal */}
      <NewMeetingModal
        isOpen={isNewMeetingModalOpen}
        onClose={() => setIsNewMeetingModalOpen(false)}
        onSuccess={(id) => {
          setIsNewMeetingModalOpen(false);
          handleNavigate(`detail:${id}`);
        }}
      />

      {/* Global Profile Card Modal */}
      {isProfileOpen && (
        <ProfileCard
          user={user}
          onSignOut={logout}
          onClose={() => setIsProfileOpen(false)}
        />
      )}
    </div>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <ToastProvider>
          <AppContent />
        </ToastProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
