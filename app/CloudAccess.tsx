"use client";

import { FormEvent, useEffect, useState } from "react";
import { supabase, supabaseConfig } from "../lib/supabase";
import { Icon } from "./WorkspaceIcon";
import type { AuthMode } from "../lib/cloud-trade-contract";

export function AuthScreen({
  mode,
  setMode,
  onRecovered,
}: {
  mode: AuthMode;
  setMode: (mode: AuthMode) => void;
  onRecovered: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) {
      setError("This journal has not been connected to Supabase yet.");
      return;
    }
    setBusy(true);
    setMessage("");
    setError("");
    const data = new FormData(event.currentTarget);
    const email = String(data.get("email") || "").trim();
    const password = String(data.get("password") || "");
    const redirectTo = `${window.location.origin}${window.location.pathname}`;
    try {
      let result: { error: { message: string } | null };

      if (mode === "signup") {
        result = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: redirectTo },
        });
        if (!result.error)
          setMessage(
            "If this email is eligible, we’ll send a confirmation link. Please check your inbox and spam folder.",
          );
      } else if (mode === "forgot") {
        result = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
        if (!result.error)
          setMessage("Password-reset link sent. Please check your email.");
      } else if (mode === "recovery") {
        result = await supabase.auth.updateUser({ password });
        if (!result.error) {
          setMessage("Password updated securely.");
          onRecovered();
        }
      } else {
        result = await supabase.auth.signInWithPassword({ email, password });
      }

      if (result.error)
        setError(
          /failed to fetch|network request failed/i.test(result.error.message)
            ? "Unable to reach the authentication service. Check your connection and try again."
            : result.error.message,
        );
    } catch {
      setError("Unable to reach the authentication service. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  const title =
    mode === "signup"
      ? "Create your journal"
      : mode === "forgot"
        ? "Reset your password"
        : mode === "recovery"
          ? "Choose a new password"
          : "Welcome back";
  const subtitle =
    mode === "signup"
      ? "Your trades stay private and synchronized across devices."
      : mode === "forgot"
        ? "We’ll send a secure recovery link to your email."
        : mode === "recovery"
          ? "Use at least eight characters for your new password."
          : "Sign in to open your private trading workspace.";

  return (
    <main className="auth-shell">
      <section className="auth-brand-panel">
        <div className="auth-brand">
          <span className="brand-mark">
            <Icon name="spark" size={19} />
          </span>
          <span>Brontide</span>
        </div>
        <div className="auth-brand-copy">
          <p className="eyebrow">Asymmetric Edge Labs</p>
          <h1>
            Review clearly.
            <br />
            Trade deliberately.
          </h1>
          <p>
            A private decision cockpit for measuring risk, execution and the
            outcomes that build your edge.
          </p>
        </div>
        <div className="auth-proof">
          <span>Secure cloud journal</span>
          <span>Multi-device sync</span>
          <span>Private by design</span>
        </div>
      </section>
      <section className="auth-form-panel">
        <div className="auth-card">
          <p className="eyebrow">Brontide</p>
          <h2>{title}</h2>
          <p className="auth-subtitle">{subtitle}</p>
          {process.env.NEXT_PUBLIC_BRONTIDE_PREVIEW_ID && <p className="preview-identity" data-preview-identifier={process.env.NEXT_PUBLIC_BRONTIDE_PREVIEW_ID} aria-label={`Preview revision ${process.env.NEXT_PUBLIC_BRONTIDE_PREVIEW_ID}`}>Preview {process.env.NEXT_PUBLIC_BRONTIDE_PREVIEW_ID}</p>}
          <form onSubmit={submit}>
            {mode !== "recovery" && (
              <label>
                Email address
                <input
                  name="email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  required
                  autoFocus
                />
              </label>
            )}
            {mode !== "forgot" && (
              <label>
                {mode === "recovery" ? "New password" : "Password"}
                <input
                  name="password"
                  type="password"
                  minLength={8}
                  autoComplete={
                    mode === "signin" ? "current-password" : "new-password"
                  }
                  placeholder="At least 8 characters"
                  required
                  autoFocus={mode === "recovery"}
                />
              </label>
            )}
            {error && (
              <p className="auth-message error" role="alert">
                {error}
              </p>
            )}
            {message && (
              <p className="auth-message success" role="status">
                {message}
              </p>
            )}
            <button
              type="submit"
              className="primary-button auth-submit"
              disabled={busy}
            >
              {busy
                ? "Please wait…"
                : mode === "signup"
                  ? "Create account"
                  : mode === "forgot"
                    ? "Send reset link"
                    : mode === "recovery"
                      ? "Update password"
                      : "Sign in"}
            </button>
          </form>
          {mode === "signin" && (
            <div className="auth-links">
              <button onClick={() => setMode("forgot")}>
                Forgot password?
              </button>
              <button onClick={() => setMode("signup")}>Create account</button>
            </div>
          )}
          {mode !== "signin" && mode !== "recovery" && (
            <button className="auth-back" onClick={() => setMode("signin")}>
              ← Back to sign in
            </button>
          )}
        </div>
      </section>
    </main>
  );
}

export function SetupScreen({
  onClose,
  forceUnconfigured = false,
}: {
  onClose?: () => void;
  forceUnconfigured?: boolean;
}) {
  const [copied, setCopied] = useState("");
  const [siteUrl, setSiteUrl] = useState(
    "https://your-name.github.io/your-repository/",
  );
  const [variablesUrl, setVariablesUrl] = useState(
    "https://github.com/settings",
  );
  const configured = supabaseConfig.isConfigured && !forceUnconfigured;

  useEffect(() => {
    if (forceUnconfigured) {
      setSiteUrl("https://your-name.github.io/Journal/");
      return;
    }
    const url = `${window.location.origin}${window.location.pathname}`;
    setSiteUrl(url.endsWith("/") ? url : `${url}/`);
    if (window.location.hostname.endsWith("github.io")) {
      const owner = window.location.hostname.split(".")[0];
      const repository = window.location.pathname.split("/").filter(Boolean)[0];
      if (owner && repository)
        setVariablesUrl(
          `https://github.com/${owner}/${repository}/settings/variables/actions`,
        );
    }
  }, [forceUnconfigured]);

  async function copy(value: string, label: string) {
    await navigator.clipboard.writeText(value);
    setCopied(label);
    window.setTimeout(() => setCopied(""), 1800);
  }

  async function copyInstaller() {
    const response = await fetch("supabase-setup.sql");
    await copy(await response.text(), "installer");
  }

  return (
    <main className={onClose ? "setup-overlay" : "setup-shell"}>
      <section className="setup-rail">
        <div className="auth-brand">
          <span className="brand-mark">
            <Icon name="spark" size={19} />
          </span>
          <span>Brontide</span>
        </div>
        <div className="setup-rail-copy">
          <p className="eyebrow">Self-hosted by design</p>
          <h1>
            Your journal.
            <br />
            Your database.
          </h1>
          <p>
            A guided, private installation that keeps every trade under your
            control.
          </p>
        </div>
        <div className="setup-trust">
          <Icon name="shield" size={17} />
          <span>
            No database passwords or privileged keys are ever stored in the
            journal.
          </span>
        </div>
      </section>

      <section className="setup-workspace">
        <header className="setup-header">
          <div>
            <p className="eyebrow">Owner setup</p>
            <h2>
              {configured ? "Cloud connection" : "Let’s connect your journal"}
            </h2>
            <p>
              {configured
                ? "This installation has a valid Supabase configuration."
                : "Four short steps. Most people finish in about five minutes."}
            </p>
          </div>
          {onClose && (
            <button
              className="icon-button"
              aria-label="Close settings"
              onClick={onClose}
            >
              <Icon name="close" />
            </button>
          )}
          {!onClose && (
            <a className="demo-link" href="?demo=1">
              Preview dashboard <Icon name="arrow" size={15} />
            </a>
          )}
        </header>

        <div className="setup-progress" aria-label="Setup progress">
          <span className={configured ? "done" : "active"} />
          <span className={configured ? "done" : ""} />
          <span className={configured ? "done" : ""} />
          <span className={configured ? "done" : ""} />
        </div>

        <div className="setup-steps">
          <article className="setup-step">
            <span className="step-number">01</span>
            <div>
              <h3>Create your cloud</h3>
              <p>
                Create a free Supabase project in the region closest to you.
                Keep the database password private.
              </p>
            </div>
            <a
              className="step-action"
              href="https://supabase.com/dashboard/new"
              target="_blank"
              rel="noreferrer"
            >
              Open Supabase <Icon name="external" size={14} />
            </a>
          </article>

          <article className="setup-step">
            <span className="step-number">02</span>
            <div>
              <h3>Install the secure database</h3>
              <p>
                Copy the prepared installer, paste it into Supabase SQL Editor
                and select Run once.
              </p>
              <small>
                Creates the trades table, index and user-isolation policies.
              </small>
            </div>
            <div className="step-actions">
              <button className="step-action" onClick={copyInstaller}>
                <Icon
                  name={copied === "installer" ? "check" : "copy"}
                  size={14}
                />
                {copied === "installer" ? "Copied" : "Copy installer"}
              </button>
              <a
                className="step-action quiet"
                href="https://supabase.com/dashboard/project/_/sql/new"
                target="_blank"
                rel="noreferrer"
              >
                SQL Editor <Icon name="external" size={14} />
              </a>
            </div>
          </article>

          <article className="setup-step">
            <span className="step-number">03</span>
            <div>
              <h3>Connect the deployment</h3>
              <p>
                Add these repository variables, then run the GitHub Pages
                workflow again.
              </p>
              <div className="variable-list">
                <code>NEXT_PUBLIC_SUPABASE_URL</code>
                <code>NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</code>
              </div>
            </div>
            <a
              className="step-action"
              href={variablesUrl}
              target="_blank"
              rel="noreferrer"
            >
              GitHub variables <Icon name="external" size={14} />
            </a>
          </article>

          <article className="setup-step">
            <span className="step-number">04</span>
            <div>
              <h3>Allow secure sign-in</h3>
              <p>
                Use this address as the Supabase Site URL and add the same
                address followed by <code>**</code> as a Redirect URL.
              </p>
              <button
                className="copy-value"
                onClick={() => copy(siteUrl, "url")}
              >
                <span>{siteUrl}</span>
                <Icon name={copied === "url" ? "check" : "copy"} size={14} />
              </button>
            </div>
            <a
              className="step-action"
              href="https://supabase.com/dashboard/project/_/auth/url-configuration"
              target="_blank"
              rel="noreferrer"
            >
              Auth settings <Icon name="external" size={14} />
            </a>
          </article>
        </div>

        <footer className="setup-footer">
          <div
            className={`connection-state ${configured ? "ready" : "waiting"}`}
          >
            <span>
              <Icon name={configured ? "check" : "database"} size={16} />
            </span>
            <div>
              <strong>
                {configured
                  ? "Configuration detected"
                  : "Waiting for deployment configuration"}
              </strong>
              <small>
                {configured
                  ? new URL(supabaseConfig.url).hostname
                  : "The journal will unlock automatically after GitHub Pages redeploys."}
              </small>
            </div>
          </div>
          <a
            href="https://github.com/Melvinroy/Journal/blob/main/docs/SELF_HOSTING.md"
            target="_blank"
            rel="noreferrer"
          >
            Read the full guide <Icon name="arrow" size={14} />
          </a>
        </footer>
      </section>
    </main>
  );
}
