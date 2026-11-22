"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

export function SignInForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    let active = true;

    async function redirectExistingSession() {
      try {
        const existingSession = await fetch("/api/me", { cache: "no-store" });
        if (existingSession.ok) {
          router.replace("/");
        }
        if (active) {
          setIsReady(true);
        }
      } catch {
        if (active) {
          setIsReady(true);
        }
      }
    }

    void redirectExistingSession();
    return () => {
      active = false;
    };
  }, [router]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);
    setIsSubmitting(true);
    try {
      const csrfResponse = await fetch("/api/csrf", { cache: "no-store" });
      const csrfPayload = (await csrfResponse.json()) as { token?: string };
      if (!csrfResponse.ok || !csrfPayload.token) {
        setErrorMessage("Unable to prepare secure sign-in. Please try again.");
        return;
      }

      const response = await fetch("/api/auth/sign-in", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrfPayload.token,
        },
        body: JSON.stringify({ email, password }),
      });

      if (!response.ok) {
        const payload = (await response.json()) as {
          error?: { code?: string };
        };
        setErrorMessage(
          payload.error?.code === "STAFF_ACCESS_DENIED"
            ? "This account does not have active RouteBook staff access."
            : payload.error?.code === "INVALID_CREDENTIALS"
              ? "Email or password is incorrect."
              : "Sign-in failed. Please try again.",
        );
        return;
      }

      router.replace("/");
    } catch {
      setErrorMessage("Unable to reach RouteBook. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="mt-7 space-y-5" onSubmit={handleSubmit}>
      <div>
        <label
          className="mb-1.5 block text-sm font-medium text-slate-800"
          htmlFor="email"
        >
          Email
        </label>
        <input
          autoComplete="username"
          className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-blue-700 focus:ring-2 focus:ring-blue-100"
          id="email"
          maxLength={254}
          name="email"
          onChange={(event) => setEmail(event.target.value)}
          required
          type="email"
          value={email}
        />
      </div>
      <div>
        <label
          className="mb-1.5 block text-sm font-medium text-slate-800"
          htmlFor="password"
        >
          Password
        </label>
        <input
          autoComplete="current-password"
          className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-blue-700 focus:ring-2 focus:ring-blue-100"
          id="password"
          maxLength={256}
          name="password"
          onChange={(event) => setPassword(event.target.value)}
          required
          type="password"
          value={password}
        />
      </div>
      {errorMessage ? (
        <p
          aria-live="polite"
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800"
          role="alert"
        >
          {errorMessage}
        </p>
      ) : null}
      <button
        className="w-full rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
        disabled={!isReady || isSubmitting}
        type="submit"
      >
        {isSubmitting ? "Signing in..." : "Sign in"}
      </button>
    </form>
  );
}
