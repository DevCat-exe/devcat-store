import { getDatabase } from "./turso";

export interface ReleaseAsset {
  name: string;
  url: string;
  size: number;
  downloadCount: number;
  sha256: string;
  source?: "github" | "fdroid";
}

export interface ReleaseHistoryEntry {
  version: string;
  tag: string;
  versionCode: number;
  publishedAt: string;
  url: string;
  notes: string;
  isPrerelease: boolean;
  source: "github" | "fdroid";
  sizeBytes: number;
  sha256: string;
  githubSha256?: string;
  fdroidUrl?: string;
  fdroidSizeBytes?: number;
  fdroidSha256?: string;
  assets?: ReleaseAsset[];
}

export interface AppRecord {
  id: string;
  slug: string;
  name: string;
  summary: string;
  description: string;
  version: string;
  size: string;
  sizeBytes: number;
  platforms: string[];
  categories: string[];
  icon: string;
  screenshots: string[];
  downloadUrl: string;
  windowsDownloadUrl: string;
  availableOnFdroid: boolean;
  fdroidPackageName: string;
  playStoreUrl: string;
  sourceUrl: string;
  license: string;
  lastUpdated: string;
  githubRepo: string;
  androidMinVersion: string;
  permissions: string[];
  releaseTag: string;
  releaseUrl: string;
  releaseNotes: string;
  releasePublishedAt: string;
  releaseIsPrerelease: boolean;
  releaseHistory: ReleaseHistoryEntry[];
  releaseAssets: ReleaseAsset[];
  releaseDownloadsCount: number;
  isFeatured: boolean;
  privacyPolicy: string;
}

export type EditableApp = Pick<
  AppRecord,
  | "slug"
  | "name"
  | "summary"
  | "description"
  | "platforms"
  | "categories"
  | "icon"
  | "screenshots"
  | "downloadUrl"
  | "windowsDownloadUrl"
  | "availableOnFdroid"
  | "fdroidPackageName"
  | "playStoreUrl"
  | "sourceUrl"
  | "license"
  | "githubRepo"
  | "androidMinVersion"
  | "permissions"
  | "isFeatured"
  | "privacyPolicy"
>;

function parseRecord(value: unknown): AppRecord {
  if (typeof value !== "string") {
    throw new Error("The app catalog contains a record with no valid JSON data.");
  }
  const parsed: unknown = JSON.parse(value);
  if (
    !parsed ||
    typeof parsed !== "object" ||
    !("slug" in parsed) ||
    typeof parsed.slug !== "string"
  ) {
    throw new Error("The app catalog contains an invalid app record.");
  }
  const app = parsed as AppRecord & { fdroidUrl?: string };
  return {
    ...app,
    id: app.slug,
    categories: Array.isArray(app.categories) ? app.categories : [],
    fdroidPackageName:
      typeof app.fdroidPackageName === "string" ? app.fdroidPackageName : "",
    windowsDownloadUrl:
      typeof app.windowsDownloadUrl === "string" ? app.windowsDownloadUrl : "",
    releaseIsPrerelease: app.releaseIsPrerelease === true,
    releaseHistory: Array.isArray(app.releaseHistory) ? app.releaseHistory : [],
    availableOnFdroid:
      typeof app.availableOnFdroid === "boolean"
        ? app.availableOnFdroid
        : Boolean(app.fdroidUrl),
  };
}

export function formatPlatformLabel(platform: string): string {
  const labels: Record<string, string> = {
    android: "Android",
    windows: "Windows",
    macos: "macOS",
    linux: "Linux",
    web: "Web",
    ios: "iOS",
  };
  return labels[platform.toLowerCase()] ??
    platform.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export async function getApps(): Promise<AppRecord[]> {
  const result = await getDatabase().execute(
    "SELECT record_json FROM apps ORDER BY is_featured DESC, name COLLATE NOCASE ASC",
  );
  return result.rows.map((row) => parseRecord(row.record_json));
}

export async function getAppBySlug(slug: string): Promise<AppRecord | null> {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return null;

  const result = await getDatabase().execute({
    sql: "SELECT record_json FROM apps WHERE slug = ? LIMIT 1",
    args: [slug],
  });
  return result.rows.length ? parseRecord(result.rows[0].record_json) : null;
}

export async function saveApp(app: EditableApp): Promise<AppRecord> {
  const database = getDatabase();
  const existingResult = await database.execute({
    sql: "SELECT record_json FROM apps WHERE slug = ? LIMIT 1",
    args: [app.slug],
  });
  const existing = existingResult.rows.length
    ? parseRecord(existingResult.rows[0].record_json)
    : null;
  const record: AppRecord = {
    id: app.slug,
    ...app,
    version: existing?.version ?? "",
    size: existing?.size ?? "",
    sizeBytes: existing?.sizeBytes ?? 0,
    lastUpdated: existing?.lastUpdated ?? "",
    releaseTag: existing?.releaseTag ?? "",
    releaseUrl: existing?.releaseUrl ?? "",
    releaseNotes: existing?.releaseNotes ?? "",
    releasePublishedAt: existing?.releasePublishedAt ?? "",
    releaseIsPrerelease: existing?.releaseIsPrerelease ?? false,
    releaseHistory: existing?.releaseHistory ?? [],
    releaseAssets: existing?.releaseAssets ?? [],
    releaseDownloadsCount: existing?.releaseDownloadsCount ?? 0,
  };

  await database.execute({
    sql: `INSERT INTO apps (slug, name, is_featured, record_json, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(slug) DO UPDATE SET
        name = excluded.name,
        is_featured = excluded.is_featured,
        record_json = excluded.record_json,
        updated_at = excluded.updated_at`,
    args: [
      record.slug,
      record.name,
      record.isFeatured ? 1 : 0,
      JSON.stringify(record),
      new Date().toISOString(),
    ],
  });

  return record;
}

export async function deleteApp(slug: string): Promise<boolean> {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return false;
  const result = await getDatabase().execute({
    sql: "DELETE FROM apps WHERE slug = ?",
    args: [slug],
  });
  return result.rowsAffected > 0;
}

export function validateEditableApp(value: unknown):
  | { app: EditableApp }
  | { error: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { error: "The app details must be a JSON object." };
  }

  const input = value as Record<string, unknown>;
  const stringFields = [
    "slug",
    "name",
    "summary",
    "description",
    "icon",
    "downloadUrl",
    "windowsDownloadUrl",
    "playStoreUrl",
    "sourceUrl",
    "license",
    "githubRepo",
    "fdroidPackageName",
    "androidMinVersion",
    "privacyPolicy",
  ] as const;
  const limits: Record<(typeof stringFields)[number], number> = {
    slug: 80,
    name: 120,
    summary: 300,
    description: 10000,
    icon: 2000,
    downloadUrl: 2000,
    windowsDownloadUrl: 2000,
    playStoreUrl: 2000,
    sourceUrl: 2000,
    license: 100,
    githubRepo: 200,
    fdroidPackageName: 255,
    androidMinVersion: 80,
    privacyPolicy: 20000,
  };
  const fields = {} as Record<(typeof stringFields)[number], string>;

  for (const field of stringFields) {
    const item = input[field] ?? "";
    if (typeof item !== "string") return { error: `${field} must be text.` };
    const text = item.trim();
    if (text.length > limits[field]) {
      return { error: `${field} must be ${limits[field]} characters or fewer.` };
    }
    fields[field] = text;
  }

  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(fields.slug)) {
    return { error: "Use a lowercase URL slug with letters, numbers, and hyphens." };
  }
  if (!fields.name) return { error: "An app name is required." };
  if (
    fields.fdroidPackageName &&
    !/^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+$/.test(fields.fdroidPackageName)
  ) {
    return { error: "F-Droid package ID must use dot-separated package segments." };
  }
  if (
    fields.githubRepo &&
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(fields.githubRepo)
  ) {
    return { error: "GitHub repository must use owner/repository format." };
  }

  for (const field of [
    "icon",
    "downloadUrl",
    "windowsDownloadUrl",
    "playStoreUrl",
    "sourceUrl",
  ] as const) {
    const url = fields[field];
    if (!url) continue;
    if (url.startsWith("/") && !url.startsWith("//")) continue;
    try {
      const parsedUrl = new URL(url);
      if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
        return { error: `${field} must use HTTP or HTTPS.` };
      }
    } catch {
      return { error: `${field} must be an absolute URL or a path on this site.` };
    }
  }

  if (
    !Array.isArray(input.platforms) ||
    input.platforms.length > 8 ||
    !input.platforms.every(
      (platform) =>
        typeof platform === "string" &&
        /^[a-z0-9 -]{1,40}$/i.test(platform.trim()),
    )
  ) {
    return { error: "Platforms must be a list of up to 8 short text labels." };
  }
  if (
    !Array.isArray(input.categories) ||
    input.categories.length > 12 ||
    !input.categories.every(
      (category) =>
        typeof category === "string" &&
        /^[a-z0-9][a-z0-9 &/-]{0,39}$/i.test(category.trim()),
    )
  ) {
    return { error: "Categories must be a list of up to 12 short labels." };
  }
  if (
    !Array.isArray(input.screenshots) ||
    input.screenshots.length > 30 ||
    !input.screenshots.every(
      (screenshot) => typeof screenshot === "string" && screenshot.length <= 2000,
    )
  ) {
    return { error: "Screenshots must be a list of up to 30 image paths or URLs." };
  }
  for (const screenshot of input.screenshots as string[]) {
    const url = screenshot.trim();
    if (!url || (url.startsWith("/") && !url.startsWith("//"))) continue;
    try {
      const parsedUrl = new URL(url);
      if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
        return { error: "Screenshot URLs must use HTTP or HTTPS." };
      }
    } catch {
      return { error: "Screenshots must be absolute URLs or paths on this site." };
    }
  }
  if (
    !Array.isArray(input.permissions) ||
    input.permissions.length > 100 ||
    !input.permissions.every(
      (permission) =>
        typeof permission === "string" && permission.trim().length <= 120,
    )
  ) {
    return { error: "Permissions must be a list of up to 100 short text labels." };
  }
  if (typeof input.isFeatured !== "boolean") {
    return { error: "Featured must be true or false." };
  }
  if (typeof input.availableOnFdroid !== "boolean") {
    return { error: "F-Droid availability must be true or false." };
  }

  return {
    app: {
      ...fields,
      platforms: [
        ...new Set((input.platforms as string[]).map((platform) => platform.trim().toLowerCase())),
      ],
      categories: [...new Set(
        (input.categories as string[]).map((category) => category.trim()),
      )],
      screenshots: (input.screenshots as string[])
        .map((screenshot) => screenshot.trim())
        .filter(Boolean),
      permissions: (input.permissions as string[])
        .map((permission) => permission.trim())
        .filter(Boolean),
      isFeatured: input.isFeatured,
      availableOnFdroid: input.availableOnFdroid,
    },
  };
}
