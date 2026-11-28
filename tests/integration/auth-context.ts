import type { StaffProfile } from "@/lib/auth/authorization";

let currentActor: StaffProfile | undefined;

export function setIntegrationActor(actor: StaffProfile) {
  currentActor = actor;
}

export function getIntegrationActor() {
  if (!currentActor) throw new Error("The integration test actor has not been configured.");
  return currentActor;
}
