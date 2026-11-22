import { redirect } from "next/navigation";
import { getCurrentStaffProfile } from "@/lib/auth/current-staff";
import { RouteBookShell } from "./navigation-shell";

export const dynamic = "force-dynamic";

export default async function Home() {
  const profile = await getCurrentStaffProfile();
  if (!profile) {
    redirect("/login");
  }

  return (
    <RouteBookShell role={profile.role}>
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <p className="text-sm font-semibold uppercase tracking-[0.16em] text-blue-700">
          {profile.role === "SUPERVISOR" ? "Supervisor" : "Driver"} workspace
        </p>
        <h1 className="mt-3 text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl">
          Welcome, {profile.displayName}
        </h1>
        <p className="mt-4 max-w-2xl text-base leading-7 text-slate-600">
          Your workspace for managing daily van-sales operations.
        </p>
      </section>
    </RouteBookShell>
  );
}
