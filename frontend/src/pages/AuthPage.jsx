import { useState, useEffect } from "react";
import { forgotPassword, googleAuth, login, register, resetPassword } from "../services/api.js";
import { useAuth } from "../context/AuthContext.jsx";

/**
 * AuthPage.jsx (Google OAuth & Email Authentication)
 *
 * Full Google OAuth 2.0 and first-class Email authentication with
 * Light Blue & White design aesthetics.
 */
export default function AuthPage() {
  const { refresh } = useAuth();
  const [mode, setMode] = useState("login"); // "login" | "register" | "forgot"

  // Login / register fields.
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");

  // Forgot-password fields.
  const [forgotStep, setForgotStep] = useState("request"); // request | reset | done
  const [resetToken, setResetToken] = useState("");
  const [resetMessage, setResetMessage] = useState("");

  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  // Initialize Google Identity Services if client ID is available
  const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID || "";

  useEffect(() => {
    // Load Google Identity Services script dynamically
    if (!document.getElementById("google-jssdk")) {
      const script = document.createElement("script");
      script.id = "google-jssdk";
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.defer = true;
      script.onload = () => {
        if (googleClientId && window.google?.accounts?.id) {
          try {
            window.google.accounts.id.initialize({
              client_id: googleClientId,
              callback: handleGoogleCredentialResponse,
              auto_select: false,
            });
          } catch (err) {
            console.warn("Google Sign-In initialization:", err);
          }
        }
      };
      document.body.appendChild(script);
    } else if (googleClientId && window.google?.accounts?.id) {
      try {
        window.google.accounts.id.initialize({
          client_id: googleClientId,
          callback: handleGoogleCredentialResponse,
          auto_select: false,
        });
      } catch (err) {
        console.warn("Google Sign-In re-init:", err);
      }
    }
  }, [googleClientId]);

  async function handleGoogleCredentialResponse(response) {
    if (!response?.credential) {
      setError("Google authentication did not return a valid credential.");
      return;
    }
    setError("");
    setGoogleLoading(true);
    try {
      await googleAuth(response.credential, googleClientId || null);
      await refresh();
    } catch (err) {
      setError(err.message || "Failed to sign in with Google.");
    } finally {
      setGoogleLoading(false);
    }
  }

  function handleGoogleButtonClick() {
    setError("");
    if (googleClientId && window.google?.accounts?.id) {
      window.google.accounts.id.prompt();
    } else {
      // In dev mode without a Google Client ID, guide user on setup
      setError(
        "Google OAuth Client ID is not configured yet. To enable real Google Sign-In, add VITE_GOOGLE_CLIENT_ID to your frontend .env and GOOGLE_CLIENT_ID to backend/.env."
      );
    }
  }

  function switchMode(next) {
    setMode(next);
    setError("");
    setBusy(false);
    if (next === "forgot") {
      setForgotStep("request");
      setResetToken("");
      setResetMessage("");
    }
  }

  async function handleLoginRegister(event) {
    event.preventDefault();
    setError("");

    if (mode === "register") {
      if (!email.trim() || !email.includes("@")) {
        setError("Please enter a valid email address.");
        return;
      }
    }

    setBusy(true);
    try {
      if (mode === "register") {
        await register({
          username: username.trim(),
          email: email.trim().toLowerCase(),
          password,
        });
      } else {
        await login({
          username: username.trim(),
          password,
        });
      }
      await refresh();
    } catch (err) {
      setError(err.message || "Authentication failed. Please check your details.");
    } finally {
      setBusy(false);
    }
  }

  async function handleRequestToken(event) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const result = await forgotPassword(username.trim());
      setResetMessage(result.message || "");
      if (result.reset_token) {
        setResetToken(result.reset_token);
        setForgotStep("reset");
      } else {
        setForgotStep("reset");
        setResetMessage(
          "If that account exists, a reset token was issued. Enter the token below."
        );
      }
    } catch (err) {
      setError(err.message || "Unable to start password reset.");
    } finally {
      setBusy(false);
    }
  }

  async function handleReset(event) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      await resetPassword(resetToken.trim(), password);
      setForgotStep("done");
      setPassword("");
    } catch (err) {
      setError(err.message || "Unable to reset password.");
    } finally {
      setBusy(false);
    }
  }

  const subtitle =
    mode === "login"
      ? "Log in to your workspace"
      : mode === "register"
      ? "Create your Studio workspace account"
      : "Reset your workspace password";

  return (
    <div className="relative min-h-screen flex items-center justify-center px-4 py-12 overflow-hidden">
      {/* Decorative ambient luminous background glows */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[580px] h-[580px] bg-blue-400/20 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute -bottom-20 -right-20 w-[420px] h-[420px] bg-sky-300/25 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute -top-20 -left-20 w-[400px] h-[400px] bg-indigo-300/20 rounded-full blur-3xl pointer-events-none" />

      <div className="relative w-full max-w-md rounded-3xl border border-white/85 bg-white/80 backdrop-blur-2xl p-8 shadow-2xl shadow-blue-900/10 transition-all">
        {/* Brand Header */}
        <div className="mb-6 text-center">
          <div className="inline-flex items-center gap-2 mb-2 font-mono text-xs text-slate-500 uppercase tracking-widest font-medium">
            <span className="h-2 w-2 rounded-full bg-[#DC2626] shadow-[0_0_8px_rgba(220,38,38,0.4)] animate-pulse" />
            Studio Access
          </div>
          <h1 className="font-display text-3xl font-medium text-slate-900">
            KeyPoints Studio
          </h1>
          <p className="mt-1.5 text-sm text-slate-500">{subtitle}</p>
        </div>

        {mode !== "forgot" && (
          <div className="mb-6 space-y-4">
            {/* Google Authentication Button */}
            <button
              type="button"
              onClick={handleGoogleButtonClick}
              disabled={googleLoading || busy}
              className="w-full flex items-center justify-center gap-3 rounded-xl border border-line bg-white/70 backdrop-blur-md px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-white hover:border-slate-300 shadow-sm transition-all active:scale-[0.98] disabled:opacity-60"
            >
              {googleLoading ? (
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600" />
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24">
                  <path
                    fill="#4285F4"
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                  />
                </svg>
              )}
              <span>{mode === "login" ? "Continue with Google" : "Sign up with Google"}</span>
            </button>
          </div>
        )}

        {mode === "forgot" && forgotStep === "done" ? (
          <div className="text-center">
            <div className="mb-4 rounded-2xl bg-emerald-50/90 border border-emerald-200/90 p-4 text-sm text-emerald-800 backdrop-blur-md">
              ✓ Password reset successfully. You can now log in with your new password.
            </div>
            <button
              onClick={() => switchMode("login")}
              className="w-full rounded-xl bg-gradient-to-r from-blue-600 to-blue-700 px-4 py-2.5 text-sm font-semibold text-white hover:from-blue-700 hover:to-blue-800 shadow-md shadow-blue-600/25 transition-all active:scale-[0.98]"
            >
              Back to log in
            </button>
          </div>
        ) : mode === "forgot" && forgotStep === "reset" ? (
          <form onSubmit={handleReset} className="space-y-4">
            {resetMessage && (
              <div className="rounded-xl bg-blue-50/90 border border-blue-200/90 px-3.5 py-2.5 text-xs text-blue-700 font-mono backdrop-blur-md">
                {resetMessage}
              </div>
            )}
            <div>
              <label
                htmlFor="reset-token"
                className="mb-1 block font-mono text-xs uppercase tracking-wider text-slate-600 font-medium"
              >
                Reset token
              </label>
              <input
                id="reset-token"
                type="text"
                required
                value={resetToken}
                onChange={(e) => setResetToken(e.target.value)}
                placeholder="Paste the reset token here"
                className="w-full rounded-xl border border-line bg-white/70 px-3.5 py-2.5 text-sm font-mono text-slate-900 placeholder:text-slate-400 focus:bg-white focus:border-blue-600 focus:ring-2 focus:ring-blue-100 focus:outline-none transition-all backdrop-blur-md"
              />
            </div>
            <div>
              <label
                htmlFor="new-password"
                className="mb-1 block font-mono text-xs uppercase tracking-wider text-slate-600 font-medium"
              >
                New password
              </label>
              <input
                id="new-password"
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 6 characters"
                autoComplete="new-password"
                className="w-full rounded-xl border border-line bg-white/70 px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:bg-white focus:border-blue-600 focus:ring-2 focus:ring-blue-100 focus:outline-none transition-all backdrop-blur-md"
              />
            </div>
            {error && (
              <p className="text-sm text-red-600 font-medium" role="alert">
                {error}
              </p>
            )}
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-xl bg-gradient-to-r from-blue-600 to-blue-700 px-4 py-2.5 text-sm font-semibold text-white hover:from-blue-700 hover:to-blue-800 shadow-md shadow-blue-600/25 transition-all active:scale-[0.98] disabled:opacity-60"
            >
              {busy ? "Please wait…" : "Reset password"}
            </button>
            <p className="text-center text-sm text-slate-500">
              <button
                type="button"
                onClick={() => switchMode("login")}
                className="font-medium text-blue-600 hover:text-blue-700 hover:underline"
              >
                ← Back to log in
              </button>
            </p>
          </form>
        ) : mode === "forgot" ? (
          <form onSubmit={handleRequestToken} className="space-y-4">
            <p className="text-sm text-slate-600 leading-relaxed">
              Enter your username or email to generate a password-reset token.
            </p>
            <div>
              <label
                htmlFor="forgot-username"
                className="mb-1 block font-mono text-xs uppercase tracking-wider text-slate-600 font-medium"
              >
                Username or Email
              </label>
              <input
                id="forgot-username"
                type="text"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="alice or alice@company.com"
                autoComplete="username"
                className="w-full rounded-xl border border-line bg-white/70 px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:bg-white focus:border-blue-600 focus:ring-2 focus:ring-blue-100 focus:outline-none transition-all backdrop-blur-md"
              />
            </div>
            {error && (
              <p className="text-sm text-red-600 font-medium" role="alert">
                {error}
              </p>
            )}
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-xl bg-gradient-to-r from-blue-600 to-blue-700 px-4 py-2.5 text-sm font-semibold text-white hover:from-blue-700 hover:to-blue-800 shadow-md shadow-blue-600/25 transition-all active:scale-[0.98] disabled:opacity-60"
            >
              {busy ? "Please wait…" : "Get reset token"}
            </button>
            <p className="text-center text-sm text-slate-500">
              <button
                type="button"
                onClick={() => switchMode("login")}
                className="font-medium text-blue-600 hover:text-blue-700 hover:underline"
              >
                ← Back to log in
              </button>
            </p>
          </form>
        ) : (
          <form onSubmit={handleLoginRegister} className="space-y-4">
            {mode === "register" && (
              <div>
                <label
                  htmlFor="email"
                  className="mb-1 block font-mono text-xs uppercase tracking-wider text-slate-600 font-medium"
                >
                  Work Email <span className="text-red-500">*</span>
                </label>
                <input
                  id="email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="alice@company.com"
                  autoComplete="email"
                  className="w-full rounded-xl border border-line bg-white/70 px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:bg-white focus:border-blue-600 focus:ring-2 focus:ring-blue-100 focus:outline-none transition-all backdrop-blur-md"
                />
              </div>
            )}

            <div>
              <label
                htmlFor="username"
                className="mb-1 block font-mono text-xs uppercase tracking-wider text-slate-600 font-medium"
              >
                {mode === "register" ? "Username" : "Username or Email"}
              </label>
              <input
                id="username"
                type="text"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder={mode === "register" ? "alice" : "alice or alice@company.com"}
                autoComplete="username"
                className="w-full rounded-xl border border-line bg-white/70 px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:bg-white focus:border-blue-600 focus:ring-2 focus:ring-blue-100 focus:outline-none transition-all backdrop-blur-md"
              />
            </div>

            <div>
              <label
                htmlFor="password"
                className="mb-1 block font-mono text-xs uppercase tracking-wider text-slate-600 font-medium"
              >
                Password
              </label>
              <input
                id="password"
                type="password"
                required
                minLength={mode === "register" ? 6 : undefined}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete={mode === "register" ? "new-password" : "current-password"}
                className="w-full rounded-xl border border-line bg-white/70 px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:bg-white focus:border-blue-600 focus:ring-2 focus:ring-blue-100 focus:outline-none transition-all backdrop-blur-md"
              />
            </div>

            {error && (
              <p className="text-sm text-red-600 font-medium" role="alert">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-xl bg-gradient-to-r from-blue-600 to-blue-700 px-4 py-2.5 text-sm font-semibold text-white hover:from-blue-700 hover:to-blue-800 shadow-md shadow-blue-600/25 transition-all active:scale-[0.98] disabled:opacity-60"
            >
              {busy
                ? "Please wait…"
                : mode === "login"
                ? "Log in to Studio"
                : "Create Studio account"}
            </button>
          </form>
        )}

        {/* Bottom Switcher */}
        <div className="mt-6 pt-4 border-t border-line/70 flex items-center justify-between text-sm text-slate-500">
          <button
            type="button"
            onClick={() => switchMode("forgot")}
            className="font-medium text-blue-600 hover:text-blue-700 hover:underline"
          >
            Forgot password?
          </button>
          {mode === "login" ? (
            <span>
              New here?{" "}
              <button
                type="button"
                onClick={() => switchMode("register")}
                className="font-medium text-blue-600 hover:text-blue-700 hover:underline ml-1"
              >
                Create account
              </button>
            </span>
          ) : (
            <span>
              Already have an account?{" "}
              <button
                type="button"
                onClick={() => switchMode("login")}
                className="font-medium text-blue-600 hover:text-blue-700 hover:underline ml-1"
              >
                Log in
              </button>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}