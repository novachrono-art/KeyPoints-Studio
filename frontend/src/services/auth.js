/**
 * auth.js
 *
 * Thin client-side token storage + change notification for Phase 12
 * (Authentication). The token is a JWT returned by the backend and sent
 * back as `Authorization: Bearer <token>` on every API call via api.js.
 *
 * The real security boundary is the backend (it never trusts a token it
 * did not sign); this file only remembers the token between page reloads
 * and lets the rest of the UI react when it changes.
 */

const TOKEN_KEY = "mom_token";
const CHANGE_EVENT = "mom:auth-change";

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
  notify();
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
  notify();
}

export function isAuthenticated() {
  return Boolean(getToken());
}

function notify() {
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/**
 * Subscribe to token changes. The callback fires whenever the token is set
 * or cleared (login, logout, or a 401 mid-session). Returns an unsubscribe
 * function for use in useEffect cleanup.
 */
export function subscribeAuthChange(callback) {
  window.addEventListener(CHANGE_EVENT, callback);
  return () => window.removeEventListener(CHANGE_EVENT, callback);
}
