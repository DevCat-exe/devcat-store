import type { APIRoute } from "astro";
import {
  deleteApp,
  getApps,
  saveApp,
  validateEditableApp,
} from "../../../lib/apps";
import { hasAdminSession, isSameOrigin } from "../../../lib/admin-auth";

export const prerender = false;

export const GET: APIRoute = async (context) => {
  if (!hasAdminSession(context)) {
    return new Response("Admin sign-in required.", { status: 401 });
  }
  try {
    return Response.json(await getApps(), {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    console.error("Unable to load app records for the admin:", error);
    return new Response("The app database could not be reached.", { status: 503 });
  }
};

export const POST: APIRoute = async (context) => {
  if (!hasAdminSession(context)) {
    return new Response("Admin sign-in required.", { status: 401 });
  }
  if (!isSameOrigin(context.request)) {
    return new Response("Request origin is not allowed.", { status: 403 });
  }
  if (Number(context.request.headers.get("content-length") ?? 0) > 1_000_000) {
    return new Response("Request body is too large.", { status: 413 });
  }

  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return new Response("A valid JSON request body is required.", { status: 400 });
  }
  const validated = validateEditableApp(body);
  if ("error" in validated) {
    return Response.json({ error: validated.error }, { status: 400 });
  }

  try {
    const app = await saveApp(validated.app);
    return Response.json(app, {
      status: 200,
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    console.error(`Unable to save app "${validated.app.slug}":`, error);
    return new Response("The app could not be saved. Check the database connection.", {
      status: 503,
    });
  }
};

export const DELETE: APIRoute = async (context) => {
  if (!hasAdminSession(context)) {
    return new Response("Admin sign-in required.", { status: 401 });
  }
  if (!isSameOrigin(context.request)) {
    return new Response("Request origin is not allowed.", { status: 403 });
  }

  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return new Response("A valid JSON request body is required.", { status: 400 });
  }
  const slug =
    body && typeof body === "object" && "slug" in body ? body.slug : undefined;
  if (typeof slug !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    return new Response("A valid app slug is required.", { status: 400 });
  }

  try {
    if (!(await deleteApp(slug))) {
      return new Response("The app was not found.", { status: 404 });
    }
    return new Response(null, {
      status: 204,
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    console.error(`Unable to delete app "${slug}":`, error);
    return new Response("The app could not be deleted. Check the database connection.", {
      status: 503,
    });
  }
};
