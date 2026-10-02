import type { APIRoute } from "astro";
import { hasAdminSession, isSameOrigin } from "../../../lib/admin-auth";
import {
  getSiteSettings,
  saveSiteSettings,
  validateSiteSettings,
} from "../../../lib/site-settings";

export const prerender = false;

export const GET: APIRoute = async (context) => {
  if (!hasAdminSession(context)) {
    return new Response("Admin sign-in required.", { status: 401 });
  }
  try {
    return Response.json(await getSiteSettings(), {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    console.error("Unable to load site settings:", error);
    return new Response("Site settings could not be loaded.", { status: 503 });
  }
};

export const POST: APIRoute = async (context) => {
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
  try {
    const currentSettings = await getSiteSettings();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return Response.json({ error: "Settings must be a JSON object." }, { status: 400 });
    }
    const validated = validateSiteSettings({ ...currentSettings, ...body });
    if ("error" in validated) {
      return Response.json({ error: validated.error }, { status: 400 });
    }
    await saveSiteSettings(validated.settings);
    return Response.json(validated.settings, {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    console.error("Unable to load or save site settings:", error);
    return new Response("Site settings could not be saved.", { status: 503 });
  }
};
