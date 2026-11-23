import { redirect } from "next/navigation";
import { getCurrentStaffProfile } from "@/lib/auth/current-staff";
import { RouteBookShell } from "@/app/navigation-shell";
import { DriverStockClient } from "./stock-client";

export const dynamic = "force-dynamic";

export default async function DriverStockPage() {
  const profile = await getCurrentStaffProfile();
  if (!profile) {
    redirect("/login");
  }
  if (profile.role !== "DRIVER") {
    redirect("/");
  }

  return (
    <RouteBookShell role="DRIVER" activePath="/driver/stock">
      <DriverStockClient />
    </RouteBookShell>
  );
}
