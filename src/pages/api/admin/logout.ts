import type { APIRoute } from "astro";
import { adminCookieName, isSameOrigin } from "../../../lib/admin-auth";

export const prerender = false;

export const POST: APIRoute = async ({ request, cookies }) => {
  if (!isSameOrigin(request)) {
    return new Response("Request origin is not allowed.", { status: 403 });
  }
  cookies.delete(adminCookieName, { path: "/api/admin" });
  return new Response(null, {
    status: 204,
    headers: { "cache-control": "no-store" },
  });
};
