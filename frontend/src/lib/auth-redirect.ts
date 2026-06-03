const DEFAULT_AUTH_DESTINATION = "/record";

/** Only allow same-origin relative paths as post-login redirects. */
export function safeAuthRedirectPath(raw: string | null | undefined): string {
  if (!raw) return DEFAULT_AUTH_DESTINATION;
  if (!raw.startsWith("/") || raw.startsWith("//")) return DEFAULT_AUTH_DESTINATION;
  if (raw === "/login" || raw.startsWith("/login?")) return DEFAULT_AUTH_DESTINATION;
  return raw;
}

export function buildLoginRedirectPath(returnTo: string): string {
  return `/login?next=${encodeURIComponent(returnTo)}`;
}
