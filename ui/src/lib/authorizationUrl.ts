import { checkOAuthEndpointUrl, oauthEndpointUrlRejectionMessage } from "@outpost/shared";

export type AuthorizationTarget =
  | { ok: true; url: string; host: string }
  | { ok: false; message: string };

/**
 * Vet an authorization URL before it becomes a top-level navigation (PAP-17099).
 *
 * The server already refuses to hand out an unsafe endpoint, but this is the
 * boundary where a bad value would actually execute — `window.location.assign`
 * on a `javascript:` URL runs script in the operator's origin — so the operator checks
 * the same rules with the same shared validator rather than trusting the
 * response body it just received.
 */
export function resolveAuthorizationTarget(value: string | null | undefined): AuthorizationTarget {
  const servedOverHttp = typeof window !== "undefined" && window.location.protocol === "http:";
  const check = checkOAuthEndpointUrl(value ?? null, {
    // An operator served over plaintext HTTP is a local-development operator, where a
    // loopback authorization server is exactly what someone is testing against.
    // An operator served over HTTPS requires HTTPS.
    allowInsecureLoopback: servedOverHttp,
    // Outpost's own origin: a first-party authorization endpoint (the smoke-lab
    // fixture) is served however the operator is, and going to the page you are
    // already on adds no exposure.
    allowInsecureOrigins: typeof window !== "undefined" ? [window.location.origin] : [],
  });
  if (check.ok) return { ok: true, url: check.url, host: check.host };
  return { ok: false, message: oauthEndpointUrlRejectionMessage("authorization", check.reason) };
}
