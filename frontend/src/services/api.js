/**
 * api.js
 *
 * Every call to the backend goes through this file. Keeping them
 * centralized here - instead of scattered fetch() calls inside
 * components - means the base URL, error handling, response shape, and
 * (Phase 12) the bearer token only need to be defined once.
 *
 * Phase 12 (Authentication): the access token is attached to every
 * request as `Authorization: Bearer <token>`, and a 401 response clears
 * the token and notifies the UI to return to the login page.
 */

import { clearToken, getToken, setToken } from "./auth.js";

// The backend runs on a different port (8000) than the frontend dev
// server (5173) during development, so every request needs the full
// URL, not just a relative path. Exported so components can build
// direct download links (e.g. PDF/DOCX export) without duplicating
// this constant.
export const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL !== undefined
    ? import.meta.env.VITE_API_BASE_URL
    : "http://127.0.0.1:8000";

/**
 * Perform a fetch with the current access token attached (if present).
 * Returns the Response; the individual calls below still handle their own
 * error messages. A 401 clears the token (so the leftover session can't be
 * used again) and notifies the AuthContext to show the login page.
 */
export async function request(url, options = {}) {
  const token = getToken();
  const headers = new Headers(options.headers || {});
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const response = await fetch(url, { ...options, headers });

  const isAuthFlow =
    typeof url === "string" && url.includes("/api/auth/");

  // Only treat a 401 as a stale/expired session when we actually sent a
  // token on some already-authenticated call. A 401 from the login or
  // register endpoints just means "bad credentials" - the backend returns
  // its own meaningful detail there (e.g. "Incorrect username or password"),
  // which we should surface instead of the misleading "Session expired".
  if (response.status === 401 && token && !isAuthFlow) {
    clearToken();
    throw new Error("Session expired. Please log in again.");
  }
  return response;
}

/**
 * Upload a meeting recording file.
 * Returns: { meeting_id, original_filename, saved_filename, size_bytes, status }
 */
export async function uploadMeeting(file) {
  const formData = new FormData();
  formData.append("file", file);

  const response = await request(`${API_BASE_URL}/api/meetings/upload`, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const errorBody = await safeParseJson(response);
    throw new Error(errorBody?.detail || "Upload failed. Please try again.");
  }

  return response.json();
}

/**
 * Run the transcription pipeline (FFmpeg + Whisper) for a meeting.
 * Optionally pass a language code (e.g. "hi", "en") to force it
 * instead of relying on auto-detection.
 * Pass diarize=true to additionally identify speakers (Phase 14).
 * Returns: { text, segments, detected_language, language_confidence, has_diarization }
 */
export async function transcribeMeeting(meetingId, language, diarize = false) {
  const url = new URL(`${API_BASE_URL}/api/meetings/${meetingId}/transcribe`);
  if (language) {
    url.searchParams.set("language", language);
  }
  if (diarize) {
    url.searchParams.set("diarize", "true");
  }

  const response = await request(url, { method: "POST" });

  if (!response.ok) {
    const errorBody = await safeParseJson(response);
    throw new Error(
      errorBody?.detail || "Transcription failed. Please try again."
    );
  }

  return response.json();
}


/**
 * Retrieve a previously generated transcript for a meeting.
 */
export async function getTranscript(meetingId) {
  const response = await request(
    `${API_BASE_URL}/api/meetings/${meetingId}/transcript`
  );

  if (!response.ok) {
    const errorBody = await safeParseJson(response);
    throw new Error(errorBody?.detail || "Unable to retrieve transcript.");
  }

  return response.json();
}

/**
 * Retrieve real-time pipeline progress for a meeting (Phase 11).
 *
 * During long-running steps the backend records its ACTUAL progress and
 * exposes it here, so the UI only ever shows what the backend genuinely
 * reports (never a fabricated percentage). Returns null if no progress
 * is currently available (e.g. nothing is running, or it just finished).
 */
export async function getMeetingProgress(meetingId) {
  try {
    const response = await request(
      `${API_BASE_URL}/api/meetings/${meetingId}/progress`
    );
    if (!response.ok) return null;
    return response.json();
  } catch {
    // Polling tolerance: transient 401/network errors just skip a tick.
    // (A real 401 already cleared the token via request(), which routes the
    // app back to the login page through AuthContext.)
    return null;
  }
}

/**
 * Run MOM (Minutes of Meeting) extraction for a meeting that already
 * has a transcript.
 * Returns: { meeting_title, meeting_date, summary, participants,
 *            discussion_points, decisions, action_items, pending_issues }
 */
export async function generateMom(meetingId) {
  const response = await request(
    `${API_BASE_URL}/api/meetings/${meetingId}/generate-mom`,
    { method: "POST" }
  );

  if (!response.ok) {
    const errorBody = await safeParseJson(response);
    throw new Error(
      errorBody?.detail || "Generating minutes failed. Please try again."
    );
  }

  return response.json();
}

/**
 * Retrieve a previously generated (or previously edited) MOM.
 */
export async function getMom(meetingId) {
  const response = await request(`${API_BASE_URL}/api/meetings/${meetingId}/mom`);

  if (!response.ok) {
    const errorBody = await safeParseJson(response);
    throw new Error(errorBody?.detail || "Unable to retrieve minutes.");
  }

  return response.json();
}

/**
 * Save user edits to a MOM. Body must match the same shape returned
 * by generateMom()/getMom() - the backend validates this strictly.
 */
export async function updateMom(meetingId, momData) {
  const response = await request(`${API_BASE_URL}/api/meetings/${meetingId}/mom`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(momData),
  });

  if (!response.ok) {
    const errorBody = await safeParseJson(response);
    throw new Error(errorBody?.detail || "Saving your edits failed.");
  }

  return response.json();
}

/**
 * Persist action item status changes directly to the database.
 */
export async function updateActionItemStatus(meetingId, itemIndex, status) {
  const response = await request(
    `${API_BASE_URL}/api/meetings/${meetingId}/action-items/${itemIndex}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    }
  );

  if (!response.ok) {
    const errorBody = await safeParseJson(response);
    throw new Error(errorBody?.detail || "Updating action item failed.");
  }

  return response.json();
}

/**
 * Send generated Minutes of Meeting (MOM) to team members on their email IDs.
 */
export async function sendMomEmail(meetingId, { recipients, custom_note, include_pdf = true }) {
  const response = await request(
    `${API_BASE_URL}/api/meetings/${meetingId}/send-mom`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recipients,
        custom_note,
        include_pdf,
      }),
    }
  );

  if (!response.ok) {
    const errorBody = await safeParseJson(response);
    throw new Error(errorBody?.detail || "Failed to send MOM email.");
  }

  return response.json();
}

/**
 * Test a Slack Incoming Webhook URL.
 */
export async function testSlackWebhook(webhookUrl) {
  const response = await request(
    `${API_BASE_URL}/api/meetings/slack/test`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ webhook_url: webhookUrl }),
    }
  );

  if (!response.ok) {
    const errorBody = await safeParseJson(response);
    throw new Error(errorBody?.detail || "Slack webhook verification failed.");
  }

  return response.json();
}

/**
 * Send generated Minutes of Meeting (MOM) to a Slack channel via webhook.
 */
export async function sendMomSlack(meetingId, { webhook_url, custom_note }) {
  const response = await request(
    `${API_BASE_URL}/api/meetings/${meetingId}/send-slack`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        webhook_url,
        custom_note,
      }),
    }
  );

  if (!response.ok) {
    const errorBody = await safeParseJson(response);
    throw new Error(errorBody?.detail || "Failed to post MOM to Slack.");
  }

  return response.json();
}

// --------------------------------------------------------------------
// Authentication (Phase 12)
// --------------------------------------------------------------------

/**
 * Register a new user. On success the backend returns an access token and
 * the user; this stores the token so subsequent calls are authenticated.
 * Returns: { access_token, token_type, user }
 */
export async function register(credentials) {
  const response = await request(`${API_BASE_URL}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(credentials),
  });

  if (!response.ok) {
    const errorBody = await safeParseJson(response);
    throw new Error(errorBody?.detail || "Registration failed.");
  }

  const data = await response.json();
  if (data.access_token) setToken(data.access_token);
  return data;
}

/**
 * Log in an existing user and store the returned access token.
 * Returns: { access_token, token_type, user }
 */
export async function login(credentials) {
  const response = await request(`${API_BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(credentials),
  });

  if (!response.ok) {
    const errorBody = await safeParseJson(response);
    throw new Error(errorBody?.detail || "Login failed.");
  }

  const data = await response.json();
  if (data.access_token) setToken(data.access_token);
  return data;
}

/**
 * Authenticate or register with Google OAuth ID token.
 * Returns: { access_token, token_type, user }
 */
export async function googleAuth(credential, clientId = null) {
  const response = await request(`${API_BASE_URL}/api/auth/google`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ credential, client_id: clientId }),
  });

  if (!response.ok) {
    const errorBody = await safeParseJson(response);
    throw new Error(errorBody?.detail || "Google authentication failed.");
  }

  const data = await response.json();
  if (data.access_token) setToken(data.access_token);
  return data;
}

/**
 * Return the currently authenticated user, or null if not authenticated
 * (used by AuthContext to recover the session on reload).
 */
export async function getCurrentUser() {
  const response = await request(`${API_BASE_URL}/api/auth/me`);
  if (!response.ok) return null;
  return response.json();
}

/**
 * Log out: clear the stored token (this notifies AuthContext to show the
 * login page). The backend uses stateless JWTs, so no server call is needed.
 */
export async function logout() {
  clearToken();
}

/**
 * Start a password reset for a username.
 * Returns { message, reset_token } - the token is returned directly in this
 * local setup (no email service); paste it into the reset-password form.
 */
export async function forgotPassword(username) {
  const response = await request(`${API_BASE_URL}/api/auth/forgot-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username }),
  });
  if (!response.ok) {
    const errorBody = await safeParseJson(response);
    throw new Error(errorBody?.detail || "Unable to start password reset.");
  }
  return response.json();
}

/**
 * Complete a password reset with the token from forgot-password.
 */
export async function resetPassword(token, newPassword) {
  const response = await request(`${API_BASE_URL}/api/auth/reset-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, new_password: newPassword }),
  });
  if (!response.ok) {
    const errorBody = await safeParseJson(response);
    throw new Error(errorBody?.detail || "Unable to reset password.");
  }
  return response.json();
}

/**
 * Change the current user's password (requires the current password).
 */
export async function changePassword(currentPassword, newPassword) {
  const response = await request(`${API_BASE_URL}/api/auth/change-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      current_password: currentPassword,
      new_password: newPassword,
    }),
  });
  if (!response.ok) {
    const errorBody = await safeParseJson(response);
    throw new Error(errorBody?.detail || "Unable to change password.");
  }
  return response.json();
}

// Helper: some error responses might not be valid JSON (e.g. if the
// server crashed before FastAPI could format one) - this avoids a
// second confusing error when trying to parse a broken response.
async function safeParseJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/**
 * Delete a meeting (and its transcript / MOM / action items / audio file).
 * Scoped to the current user server-side.
 */
export async function deleteMeeting(meetingId) {
  const response = await request(`${API_BASE_URL}/api/meetings/${meetingId}`, {
    method: "DELETE",
  });
  if (!response.ok && response.status !== 404) {
    const errorBody = await safeParseJson(response);
    throw new Error(errorBody?.detail || "Unable to delete meeting.");
  }
  return true;
}

/**
 * Rename a meeting title.
 */
export async function renameMeeting(meetingId, newTitle) {
  const response = await request(`${API_BASE_URL}/api/meetings/${meetingId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: newTitle }),
  });

  if (!response.ok) {
    const errorBody = await safeParseJson(response);
    throw new Error(errorBody?.detail || "Failed to rename meeting.");
  }

  return response.json();
}

// --------------------------------------------------------------------
// Dashboard & History (Phase 13)
// --------------------------------------------------------------------

/**
 * Fetch the current user's meeting dashboard.
 *
 * Options (all optional): q (search), status (completed|failed|in_progress
 * or an exact status), sort (updated_at|created_at|title), order
 * (asc|desc), page (1-based), pageSize.
 * Returns { items, total, page, page_size, pages, stats, recent }.
 */
export async function listMeetings(options = {}) {
  const {
    q,
    status,
    sort = "updated_at",
    order = "desc",
    page = 1,
    pageSize = 10,
  } = options;

  const url = new URL(`${API_BASE_URL}/api/meetings`);
  if (q) url.searchParams.set("q", q);
  if (status) url.searchParams.set("status", status);
  url.searchParams.set("sort", sort);
  url.searchParams.set("order", order);
  url.searchParams.set("page", page);
  url.searchParams.set("page_size", pageSize);

  const response = await request(url);
  if (!response.ok) {
    const errorBody = await safeParseJson(response);
    throw new Error(errorBody?.detail || "Unable to load meetings.");
  }
  return response.json();
}

/**
 * Fetch a single meeting's detail/summary metadata for the current user.
 * Returns { meeting_id, title, original_filename, status, created_at,
 *           updated_at, has_transcript, has_mom, action_items, summary }.
 */
export async function getMeetingDetail(meetingId) {
  const response = await request(`${API_BASE_URL}/api/meetings/${meetingId}`);
  if (!response.ok) {
    const errorBody = await safeParseJson(response);
    throw new Error(errorBody?.detail || "Unable to load meeting.");
  }
  return response.json();
}

/**
 * Download a MOM export (pdf | docx) as an authenticated file download.
 *
 * The plain <a href> links can't carry the Authorization header, so we fetch
 * the bytes with the token, wrap them in a Blob URL, and click a temp link.
 */
export async function downloadExport(meetingId, format) {
  const response = await request(
    `${API_BASE_URL}/api/meetings/${meetingId}/export/${format}`
  );
  if (!response.ok) {
    const errorBody = await safeParseJson(response);
    throw new Error(errorBody?.detail || "Download failed.");
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `MOM_${meetingId}.${format}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

