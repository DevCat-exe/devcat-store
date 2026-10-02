import type { APIRoute } from "astro";
import {
  adminCookieName,
  createAdminSession,
  isSameOrigin,
  sessionDuration,
  verifyAdminPassword,
} from "../../../lib/admin-auth";

export const prerender = false;

export const POST: APIRoute = async ({ request, cookies }) => {
  if (!isSameOrigin(request)) {
    return new Response("Request origin is not allowed.", { status: 403 });
  }
  if (Number(request.headers.get("content-length") ?? 0) > 2048) {
    return new Response("Request body is too large.", { status: 413 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response("A valid JSON request body is required.", { status: 400 });
  }
  const password =
    body && typeof body === "object" && "password" in body
      ? body.password
      : undefined;

  try {
    if (!verifyAdminPassword(password)) {
      return new Response("Incorrect admin password.", { status: 401 });
    }
    cookies.set(adminCookieName, createAdminSession(), {
      httpOnly: true,
      secure: import.meta.env.PROD,
      sameSite: "strict",
      path: "/api/admin",
      maxAge: sessionDuration,
    });
    return new Response(null, {
      status: 204,
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    console.error("Admin login is not configured correctly:", error);
    return new Response("Admin login is not configured on the server.", {
      status: 503,
    });
  }
};
