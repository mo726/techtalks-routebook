"use client";

import { useState, type ChangeEvent, type FormEvent } from "react";
import { mockProducts, mockVanDays } from "@/lib/mock-van-load";

type Quantities = Record<string, string>;
type SavedQuantities = Record<string, number>;
type LoadsByVanDay = Record<string, Quantities>;
type SavedLoadsByVanDay = Record<string, SavedQuantities>;

function makeInitialLoads(): LoadsByVanDay {
  return Object.fromEntries(
    mockVanDays.map((vanDay) => [
      vanDay.id,
      Object.fromEntries(
        mockProducts.map((product) => [
          product.id,
          String(vanDay.openingQuantities[product.id] ?? 0),
        ]),
      ),
    ]),
  );
}

function makeInitialSavedLoads(): SavedLoadsByVanDay {
  return Object.fromEntries(
    mockVanDays.map((vanDay) => [vanDay.id, vanDay.openingQuantities]),
  );
}

export default function VanLoadPage() {
  const [selectedVanDayId, setSelectedVanDayId] = useState(mockVanDays[0].id);
  const [loadsByVanDay, setLoadsByVanDay] =
    useState<LoadsByVanDay>(makeInitialLoads);
  const [savedLoadsByVanDay, setSavedLoadsByVanDay] =
    useState<SavedLoadsByVanDay>(makeInitialSavedLoads);
  const [errors, setErrors] = useState<Quantities>({});
  const [savedVanDayIds, setSavedVanDayIds] = useState<string[]>([]);

  const selectedVanDay =
    mockVanDays.find((vanDay) => vanDay.id === selectedVanDayId) ?? mockVanDays[0];
  const quantities = loadsByVanDay[selectedVanDay.id];
  const savedQuantities = savedLoadsByVanDay[selectedVanDay.id];
  const isReadOnly = selectedVanDay.status !== "PREPARING";
  const hasSaved = savedVanDayIds.includes(selectedVanDay.id);

  function handleVanDayChange(event: ChangeEvent<HTMLSelectElement>) {
    setSelectedVanDayId(event.target.value);
    setErrors({});
  }

  function handleQuantityChange(productId: string, value: string) {
    if (isReadOnly) return;

    setLoadsByVanDay((current) => ({
      ...current,
      [selectedVanDay.id]: {
        ...current[selectedVanDay.id],
        [productId]: value,
      },
    }));
    setErrors((current) => {
      const next = { ...current };
      delete next[productId];
      delete next.form;
      return next;
    });
    setSavedVanDayIds((current) =>
      current.filter((vanDayId) => vanDayId !== selectedVanDay.id),
    );
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isReadOnly) return;

    const nextErrors: Quantities = {};
    const parsedQuantities: SavedQuantities = {};

    for (const product of mockProducts) {
      const value = quantities[product.id] ?? "";

      if (value.trim() === "") {
        nextErrors[product.id] = "Enter a quantity for this product.";
        continue;
      }

      if (!/^\d+$/.test(value.trim())) {
        nextErrors[product.id] = "Enter a whole number that is zero or greater.";
        continue;
      }

      const quantity = Number(value);
      if (!Number.isSafeInteger(quantity)) {
        nextErrors[product.id] = "Enter a smaller whole number.";
        continue;
      }

      if (quantity > 1_000_000) {
        nextErrors[product.id] = "Quantity cannot exceed 1,000,000.";
        continue;
      }

      parsedQuantities[product.id] = quantity;
    }

    if (
      Object.keys(nextErrors).length === 0 &&
      !Object.values(parsedQuantities).some((quantity) => quantity > 0)
    ) {
      nextErrors.form = "Enter a quantity greater than zero for at least one product.";
    }

    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    setSavedLoadsByVanDay((current) => ({
      ...current,
      [selectedVanDay.id]: parsedQuantities,
    }));
    setLoadsByVanDay((current) => ({
      ...current,
      [selectedVanDay.id]: Object.fromEntries(
        Object.entries(parsedQuantities).map(([productId, quantity]) => [
          productId,
          String(quantity),
        ]),
      ),
    }));
    setSavedVanDayIds((current) =>
      current.includes(selectedVanDay.id)
        ? current
        : [...current, selectedVanDay.id],
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-900 sm:px-6 sm:py-12">
      <div className="mx-auto max-w-4xl">
        <header className="mb-8">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-blue-700">
            RouteBook · Supervisor
          </p>
          <h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
            Opening van load
          </h1>
          <p className="mt-2 max-w-2xl text-slate-600">
            Record the products and quantities loaded before the driver starts
            the route.
          </p>
        </header>

        <section
          aria-label="Van day details"
          className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6"
        >
          <label
            htmlFor="van-day"
            className="text-xs font-semibold uppercase tracking-wide text-slate-500"
          >
            Select van day
          </label>
          <select
            id="van-day"
            value={selectedVanDay.id}
            onChange={handleVanDayChange}
            className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 outline-none focus:ring-2 focus:ring-blue-600"
          >
            {mockVanDays.map((vanDay) => (
              <option key={vanDay.id} value={vanDay.id}>
                {vanDay.vanCode} · {formatBusinessDate(vanDay.businessDate)} · {vanDay.status}
              </option>
            ))}
          </select>

          <div className="mt-5 grid gap-4 border-t border-slate-100 pt-5 sm:grid-cols-2 lg:grid-cols-4">
            <Detail label="Van" value={selectedVanDay.vanCode} />
            <Detail label="Assigned driver" value={selectedVanDay.driverName} />
            <Detail
              label="Business date"
              value={formatBusinessDate(selectedVanDay.businessDate)}
            />
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Van-day status
              </p>
              <span className="mt-2 inline-flex rounded-full bg-amber-100 px-3 py-1 text-sm font-semibold text-amber-900">
                {selectedVanDay.status}
              </span>
            </div>
          </div>
        </section>

        {isReadOnly && (
          <div className="mb-6 rounded-xl border border-slate-300 bg-slate-100 p-4 text-sm text-slate-700">
            This van day is {selectedVanDay.status.toLowerCase()}. Its load is
            read-only.
          </div>
        )}

        {hasSaved && (
          <section
            aria-live="polite"
            className="mb-6 rounded-xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-950"
          >
            <h2 className="font-semibold">Load saved successfully</h2>
            <p className="mt-1 text-sm text-emerald-800">
              This demo saved the quantities in page state. They will reset if
              you refresh the page.
            </p>
            <ul className="mt-3 grid gap-1 text-sm sm:grid-cols-3">
              {mockProducts.map((product) => (
                <li key={product.id}>
                  <span className="font-medium">{product.name}:</span>{" "}
                  {savedQuantities[product.id]} {product.unit}
                </li>
              ))}
            </ul>
          </section>
        )}

        <form
          onSubmit={handleSubmit}
          noValidate
          className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7"
        >
          <div className="mb-5">
            <h2 className="text-xl font-semibold">Products to load</h2>
            <p className="mt-1 text-sm text-slate-600">
              Enter a whole-number quantity from 0 to 1,000,000 for every
              product. Use 0 if none is loaded.
            </p>
          </div>

          {errors.form && (
            <p role="alert" className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">
              {errors.form}
            </p>
          )}

          <div className="space-y-4">
            {mockProducts.map((product) => {
              const error = errors[product.id];
              const inputId = `quantity-${product.id}`;

              return (
                <div
                  key={product.id}
                  className="grid gap-3 border-b border-slate-100 pb-4 last:border-0 last:pb-0 sm:grid-cols-[1fr_12rem] sm:items-center"
                >
                  <label htmlFor={inputId} className="font-medium">
                    {product.name}
                    <span className="mt-1 block text-sm font-normal text-slate-500">
                      Quantity in {product.unit}
                    </span>
                  </label>
                  <div>
                    <input
                      id={inputId}
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={quantities[product.id] ?? ""}
                      onChange={(event) =>
                        handleQuantityChange(product.id, event.target.value)
                      }
                      disabled={isReadOnly}
                      aria-invalid={Boolean(error)}
                      aria-describedby={error ? `${inputId}-error` : undefined}
                      className={`w-full rounded-lg border px-3 py-2.5 outline-none focus:ring-2 focus:ring-blue-600 disabled:bg-slate-100 disabled:text-slate-500 ${
                        error ? "border-red-500" : "border-slate-300"
                      }`}
                      placeholder="e.g. 100"
                    />
                    {error && (
                      <p id={`${inputId}-error`} className="mt-1 text-sm text-red-700">
                        {error}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-7 flex flex-col-reverse gap-3 border-t border-slate-100 pt-5 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-slate-500">All quantities are in whole units.</p>
            <button
              type="submit"
              disabled={isReadOnly}
              className="rounded-lg bg-blue-700 px-5 py-3 font-semibold text-white transition hover:bg-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2 disabled:cursor-not-allowed disabled:bg-slate-400"
            >
              Save Load
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}

function formatBusinessDate(date: string) {
  return new Date(`${date}T12:00:00`).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p className="mt-2 font-medium">{value}</p>
    </div>
  );
}
