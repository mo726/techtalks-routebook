export function isMissingAuthSession(
  error: { name?: string; status?: number } | null | undefined,
): boolean {
  return error?.name === "AuthSessionMissingError" || error?.status === 401;
}
