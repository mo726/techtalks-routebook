"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function SignOutButton() {
  const router = useRouter();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function signOut() {
    setIsSigningOut(true);
    setErrorMessage(null);

    try {
      const csrfResponse = await fetch("/api/csrf", { cache: "no-store" });
      const csrfPayload = (await csrfResponse.json()) as { token?: string };
      if (!csrfResponse.ok || !csrfPayload.token) {
        throw new Error("Unable to prepare secure sign-out.");
      }

      const response = await fetch("/api/auth/sign-out", {
        method: "POST",
        headers: { "X-CSRF-Token": csrfPayload.token },
      });

      if (!response.ok) {
        throw new Error("Sign-out failed. Please try again.");
      }

      router.replace("/login");
    } catch {
      setErrorMessage("Sign-out failed. Please try again.");
      setIsSigningOut(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      {errorMessage ? (
        <span aria-live="polite" className="text-xs text-red-700" role="alert">
          {errorMessage}
        </span>
      ) : null}
      <button
        className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:opacity-60"
        disabled={isSigningOut}
        onClick={signOut}
        type="button"
      >
        {isSigningOut ? "Signing out..." : "Sign out"}
      </button>
    </div>
  );
}
