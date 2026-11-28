"use client";

import { useEffect, useState } from "react";
import { ApiClientError, getDriverVisits } from "@/lib/api/client";
import type { DriverVisitsResponse } from "@/lib/api/contracts/driver-visits";
import { Alert, EmptyState, ErrorState, LoadingState } from "@/components/ui";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: DriverVisitsResponse["data"] };

function getErrorMessage(error: unknown): string {
  if (error instanceof ApiClientError && error.status === 401) {
    return "Your session has expired. Sign in again to view assigned visits.";
  }
  if (error instanceof ApiClientError && error.status === 403) {
    return "This page is available to driver accounts.";
  }
  return "Assigned visits could not be loaded. Please try again.";
}

export function DriverVisitsClient() {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void getDriverVisits(controller.signal).then(
      (response) => setState({ status: "ready", data: response.data }),
      (error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        setState({ status: "error", message: getErrorMessage(error) });
      },
    );
    return () => controller.abort();
  }, [reloadKey]);

  if (state.status === "loading") {
    return <LoadingState label="Loading your assigned visits…" />;
  }

  if (state.status === "error") {
    return (
      <ErrorState
        message={state.message}
        onRetry={() => {
          setState({ status: "loading" });
          setReloadKey((key) => key + 1);
        }}
        title="Could not load visits"
      />
    );
  }

  const { vanDay, visits } = state.data;

  return (
    <section className="space-y-5">
      <header className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <p className="text-sm font-semibold uppercase tracking-[0.16em] text-blue-700">
          Driver workspace
        </p>
        <h1 className="mt-3 text-3xl font-bold tracking-tight text-slate-950">
          Assigned visits
        </h1>
        {vanDay ? (
          <p className="mt-3 text-sm text-slate-600">
            {vanDay.vanCode} ·{" "}
            <time dateTime={vanDay.businessDate}>{vanDay.businessDate}</time>
          </p>
        ) : null}
      </header>

      {!vanDay ? (
        <Alert title="No open van day" variant="info">
          No open van day is currently assigned to you.
        </Alert>
      ) : null}

      {vanDay && visits.length > 0 ? (
        <ol
          aria-label="Assigned customer visits"
          className="space-y-3"
        >
          {visits.map((visit) => (
            <li
              className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
              key={visit.id}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Stop {visit.position}
                  </p>
                  <h2 className="mt-1 text-lg font-semibold text-slate-950">
                    {visit.customer.name}
                  </h2>
                  <p className="mt-1 text-sm text-slate-600">
                    {visit.customer.location}
                  </p>
                </div>
                {visit.invoice ? (
                  <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800">
                    Invoice RB-{visit.invoice.number}
                  </span>
                ) : (
                  <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-800">
                    Not invoiced
                  </span>
                )}
              </div>
            </li>
          ))}
        </ol>
      ) : vanDay ? (
        <EmptyState
          description="No customer visits have been assigned to this van day yet."
          title="No assigned visits"
        />
      ) : null}
    </section>
  );
}
