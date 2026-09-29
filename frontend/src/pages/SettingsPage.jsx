/**
 * SettingsPage.jsx - Studio Preferences, Transcriptions & Integrations
 */

import { useState } from "react";
import { useToast } from "../context/ToastContext.jsx";
import { testSlackWebhook } from "../services/api.js";
import "./SettingsPage.css";

export default function SettingsPage() {
  const toast = useToast();
  const [testingSlack, setTestingSlack] = useState(false);

  const [settings, setSettings] = useState(() => {
    try {
      const saved = localStorage.getItem("mom_workspace_settings");
      if (saved) return JSON.parse(saved);
    } catch {
      // fallback
    }
    return {
      defaultLang: "en",
      autoDiarize: true,
      slackWebhookUrl: "",
      emailDigest: true,
      inAppAlerts: true,
      retentionDays: "never",
      zoomConnected: false,
      meetConnected: false,
      slackConnected: false,
      teamsConnected: false,
    };
  });

  function updateSetting(key, val) {
    setSettings((prev) => {
      const next = { ...prev, [key]: val };
      localStorage.setItem("mom_workspace_settings", JSON.stringify(next));
      return next;
    });
  }

  function handleSaveAll() {
    localStorage.setItem("mom_workspace_settings", JSON.stringify(settings));
    toast.success("Workspace preferences saved successfully.");
  }

  async function handleTestSlack() {
    const url = settings.slackWebhookUrl?.trim();
    if (!url) {
      toast.error("Please enter a Slack Incoming Webhook URL first.");
      return;
    }
    if (!url.startsWith("https://hooks.slack.com/")) {
      toast.error("Invalid Webhook URL. It must begin with https://hooks.slack.com/");
      return;
    }

    setTestingSlack(true);
    try {
      await testSlackWebhook(url);
      toast.success("Test ping sent to your Slack channel successfully!");
    } catch (err) {
      toast.error(err.message || "Failed to reach Slack webhook.");
    } finally {
      setTestingSlack(false);
    }
  }

  return (
    <div className="settings-page-root">
      <div className="settings-page-wrap">
        <div className="settings-header">
          <h1 className="settings-title">Settings & Preferences</h1>
          <p className="settings-sub">Manage transcription defaults, team notifications, and studio connectors.</p>
        </div>

        {/* 1. Transcription & AI Defaults */}
        <div className="settings-section-card">
          <div className="settings-section-header">
            <h3 className="settings-section-title">Transcription & Processing</h3>
            <span className="settings-badge settings-badge-active">✓ Active Defaults</span>
          </div>
          <p className="settings-section-sub">These defaults are automatically applied when uploading new meetings in Studio.</p>

          <div className="settings-row" style={{ borderTop: "none" }}>
            <div className="settings-row-info">
              <h4>Default Transcription Language</h4>
              <p>Pre-select Whisper language mode for faster processing.</p>
            </div>
            <select
              className="new-meeting-input"
              style={{ width: "220px" }}
              value={settings.defaultLang || ""}
              onChange={(e) => updateSetting("defaultLang", e.target.value)}
            >
              <option value="">Auto-detect (English / Hinglish)</option>
              <option value="en">English (Primary)</option>
              <option value="hi">Hinglish / Hindi</option>
            </select>
          </div>

          <div className="settings-row">
            <div className="settings-row-info">
              <h4>Automatic Speaker Diarization</h4>
              <p>Identify distinct speakers (Speaker 1, Speaker 2) by default on upload.</p>
            </div>
            <div
              className={`settings-toggle ${settings.autoDiarize ? "checked" : ""}`}
              onClick={() => updateSetting("autoDiarize", !settings.autoDiarize)}
            >
              <div className="settings-toggle-knob" />
            </div>
          </div>
        </div>

        {/* 2. Notifications & Webhooks */}
        <div className="settings-section-card">
          <div className="settings-section-header">
            <h3 className="settings-section-title">Notifications & Webhooks</h3>
            <span className="settings-badge settings-badge-active">✓ Live Integration</span>
          </div>
          <p className="settings-section-sub">Configure how finished meeting minutes and action items are shared.</p>

          <div className="settings-row" style={{ borderTop: "none" }}>
            <div className="settings-row-info">
              <h4>Slack Incoming Webhook URL</h4>
              <p>Post generated MOM and action item summaries directly to your Slack channel.</p>
            </div>
            <div className="webhook-input-group">
              <input
                type="url"
                className="webhook-input"
                placeholder="https://hooks.slack.com/services/..."
                value={settings.slackWebhookUrl || ""}
                onChange={(e) => updateSetting("slackWebhookUrl", e.target.value)}
              />
              <button
                type="button"
                className="pill-btn confirm"
                style={{ height: "36px", padding: "0 14px", background: "var(--pine)", color: "#0E1412", whiteSpace: "nowrap" }}
                onClick={handleTestSlack}
                disabled={testingSlack}
              >
                {testingSlack ? "Testing..." : "Send Test Ping"}
              </button>
            </div>
          </div>

          <div className="settings-row">
            <div className="settings-row-info">
              <h4>Email Distribution</h4>
              <p>Send MOM to team members via the <strong>Send MOM</strong> button on any meeting detail page.</p>
            </div>
            <span className="text-xs text-pine font-mono">Ready to use</span>
          </div>

          <div className="settings-row">
            <div className="settings-row-info">
              <h4>In-App Notifications</h4>
              <p>Receive immediate alerts and toast notifications when transcription or MOM completes.</p>
            </div>
            <div
              className={`settings-toggle ${settings.inAppAlerts ? "checked" : ""}`}
              onClick={() => updateSetting("inAppAlerts", !settings.inAppAlerts)}
            >
              <div className="settings-toggle-knob" />
            </div>
          </div>
        </div>

        {/* 3. Data Retention */}
        <div className="settings-section-card">
          <div className="settings-section-header">
            <h3 className="settings-section-title">Storage & Retention</h3>
            <span className="settings-badge settings-badge-client">✦ Client Preference</span>
          </div>
          <p className="settings-section-sub">Specify preferred retention policies for local recordings and transcript drafts.</p>

          <div className="settings-row" style={{ borderTop: "none" }}>
            <div className="settings-row-info">
              <h4>Recording Retention Preference</h4>
              <p>Target duration to keep raw audio files in storage after MOM generation.</p>
            </div>
            <select
              className="new-meeting-input"
              style={{ width: "180px" }}
              value={settings.retentionDays || "never"}
              onChange={(e) => updateSetting("retentionDays", e.target.value)}
            >
              <option value="never">Keep Indefinitely</option>
              <option value="30">30 Days</option>
              <option value="60">60 Days</option>
              <option value="90">90 Days</option>
            </select>
          </div>
        </div>

        {/* 4. Connected Integrations (Roadmap) */}
        <div className="settings-section-card">
          <div className="settings-section-header">
            <h3 className="settings-section-title">Cloud Video Connectors</h3>
            <span className="settings-badge settings-badge-roadmap">✦ Roadmap / Coming Soon</span>
          </div>
          <p className="settings-section-sub">Direct cloud recording import connectors planned for upcoming enterprise releases.</p>

          <div className="integration-item disabled">
            <div className="integration-info">
              <span className="integration-icon">📹</span>
              <div>
                <h4 className="text-sm font-medium text-ink">Zoom Cloud Recordings</h4>
                <p className="text-xs text-muted">Auto-import cloud recordings from Zoom OAuth account</p>
              </div>
            </div>
            <span className="settings-badge settings-badge-roadmap">Planned</span>
          </div>

          <div className="integration-item disabled">
            <div className="integration-info">
              <span className="integration-icon">👥</span>
              <div>
                <h4 className="text-sm font-medium text-ink">Google Meet & Drive</h4>
                <p className="text-xs text-muted">Import Google Drive meeting recordings directly</p>
              </div>
            </div>
            <span className="settings-badge settings-badge-roadmap">Planned</span>
          </div>

          <div className="integration-item disabled">
            <div className="integration-info">
              <span className="integration-icon">💼</span>
              <div>
                <h4 className="text-sm font-medium text-ink">Microsoft Teams</h4>
                <p className="text-xs text-muted">Import Teams meeting recordings and channel meetings</p>
              </div>
            </div>
            <span className="settings-badge settings-badge-roadmap">Planned</span>
          </div>
        </div>

        {/* Save button */}
        <div className="flex justify-end">
          <button type="button" className="btn btn-primary" onClick={handleSaveAll}>
            Save All Preferences
          </button>
        </div>
      </div>
    </div>
  );
}
