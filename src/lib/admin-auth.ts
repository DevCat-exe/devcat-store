import { createHmac, createHash, timingSafeEqual } from "node:crypto";
import type { APIContext } from "astro";

export const adminCookieName = "devcat_admin";
const sessionDurationSeconds = 60 * 60 * 12;

function getSessionSecret(): string {
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("ADMIN_SESSION_SECRET must be configured with at least 32 characters.");
  }
  return secret;
}

function sign(expiresAt: string): string {
  return createHmac("sha256", getSessionSecret())
    .update(expiresAt)
    .digest("base64url");
}

export function verifyAdminPassword(password: unknown): boolean {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected || expected.length < 15) {
    throw new Error("ADMIN_PASSWORD must be configured with at least 15 characters.");
  }
  if (typeof password !== "string" || password.length > 512) return false;
  const expectedDigest = createHash("sha256").update(expected).digest();
  const suppliedDigest = createHash("sha256").update(password).digest();
  return timingSafeEqual(expectedDigest, suppliedDigest);
}

export function createAdminSession(): string {
  const expiresAt = String(Math.floor(Date.now() / 1000) + sessionDurationSeconds);
  return `${expiresAt}.${sign(expiresAt)}`;
}

export function hasAdminSession(context: APIContext): boolean {
  const session = context.cookies.get(adminCookieName)?.value;
  if (!session) return false;

  const [expiresAt, signature, ...extra] = session.split(".");
  if (extra.length || !/^\d+$/.test(expiresAt) || !signature) return false;
  if (Number(expiresAt) <= Math.floor(Date.now() / 1000)) return false;

  let expectedSignature: string;
  try {
    expectedSignature = sign(expiresAt);
  } catch {
    return false;
  }

  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);
  return (
    actualBuffer.length === expectedBuffer.length &&
    timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    const originUrl = new URL(origin);
    const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
    const host = forwardedHost || request.headers.get("host");
    const forwardedProtocol = request.headers
      .get("x-forwarded-proto")
      ?.split(",")[0]
      ?.trim();
    const protocol = forwardedProtocol || new URL(request.url).protocol.replace(/:$/, "");
    if (!host || (protocol !== "http" && protocol !== "https")) return false;
    return originUrl.origin === new URL(`${protocol}://${host}`).origin;
  } catch {
    return false;
  }
}

export const sessionDuration = sessionDurationSeconds;
