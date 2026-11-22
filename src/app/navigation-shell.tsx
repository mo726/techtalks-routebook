"use client";

import Link from "next/link";
import { useState } from "react";
import { SignOutButton } from "./sign-out-button";
import type { StaffRole } from "@/lib/auth/authorization";

type NavigationItem = {
  label: string;
  href: string;
};

const navigationByRole: Record<StaffRole, NavigationItem[]> = {
  DRIVER: [
    { label: "Overview", href: "/" },
    { label: "Assigned visits", href: "/driver/visits" },
    { label: "Van stock", href: "/driver/stock" },
  ],
  SUPERVISOR: [
    { label: "Overview", href: "/" },
    { label: "Customers", href: "/supervisor/customers" },
    { label: "Van days", href: "/supervisor/van-days" },
    { label: "Reconciliation", href: "/supervisor/reconciliation" },
  ],
};

type RouteBookShellProps = {
  role: StaffRole;
  activePath?: string;
  children: React.ReactNode;
};

export function RouteBookShell({
  role,
  activePath = "/",
  children,
}: RouteBookShellProps) {
  const [isNavigationOpen, setIsNavigationOpen] = useState(false);
  const roleLabel = role === "SUPERVISOR" ? "Supervisor" : "Driver";

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <a
        className="sr-only z-50 rounded-md bg-white px-4 py-2 text-sm font-semibold shadow focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
        href="#main-content"
      >
        Skip to content
      </a>

      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex min-h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <button
              aria-controls="primary-navigation"
              aria-expanded={isNavigationOpen}
              aria-label={
                isNavigationOpen
                  ? "Close navigation menu"
                  : "Open navigation menu"
              }
              className="inline-flex size-10 items-center justify-center rounded-lg border border-slate-200 text-slate-700 transition hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 md:hidden"
              onClick={() => setIsNavigationOpen((isOpen) => !isOpen)}
              type="button"
            >
              <svg
                aria-hidden="true"
                className="size-5"
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeWidth="2"
                viewBox="0 0 24 24"
              >
                {isNavigationOpen ? (
                  <path d="m6 6 12 12M18 6 6 18" />
                ) : (
                  <path d="M3 6h18M3 12h18M3 18h18" />
                )}
              </svg>
            </button>
            <Link
              className="flex items-center gap-3 rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-700"
              href="/"
            >
              <span className="flex size-9 items-center justify-center rounded-xl bg-blue-700 text-sm font-bold text-white">
                R
              </span>
              <span className="text-lg font-bold tracking-tight text-slate-950">
                RouteBook
              </span>
            </Link>
          </div>

          <div className="flex items-center gap-3">
            <span className="hidden rounded-full border border-blue-100 bg-blue-50 px-3 py-1 text-xs font-semibold tracking-wide text-blue-800 sm:inline-flex">
              {roleLabel} workspace
            </span>
            <SignOutButton />
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 md:flex-row md:gap-8 md:px-8 md:py-8 lg:px-8">
        <aside className="w-full shrink-0 md:w-56">
          <nav
            aria-label="Primary navigation"
            className={`${isNavigationOpen ? "block" : "hidden"} md:block`}
            id="primary-navigation"
          >
            <ul className="space-y-1 rounded-xl border border-slate-200 bg-white p-2 shadow-sm">
              {navigationByRole[role].map(({ href, label }) => {
                const isActive = href === activePath;

                return (
                  <li key={href}>
                    <Link
                      aria-current={isActive ? "page" : undefined}
                      className={`block rounded-lg px-3 py-2.5 text-sm font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 ${
                        isActive
                          ? "bg-blue-50 text-blue-800"
                          : "text-slate-600 hover:bg-slate-50 hover:text-slate-950"
                      }`}
                      href={href}
                      onClick={() => setIsNavigationOpen(false)}
                    >
                      {label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
        </aside>

        <main className="min-w-0 flex-1" id="main-content">
          {children}
        </main>
      </div>
    </div>
  );
}
