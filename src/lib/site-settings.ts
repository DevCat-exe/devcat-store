import { getDatabase } from "./turso";

export interface SiteSettings {
  fdroidRepoUrl: string;
  fdroidFingerprint: string;
  categories: string[];
  platforms: string[];
}

export const defaultSiteSettings: SiteSettings = {
  fdroidRepoUrl: "https://devcat-exe.github.io/devcat-fdroid-repo/repo",
  fdroidFingerprint:
    "2DF393D82A16ACDA06DDECAE7870001786EF1077921151F291C7D0A326AF127E",
  categories: [
    "Money",
    "Tools",
    "Productivity",
    "Health",
    "Education",
    "Travel",
    "Lifestyle",
    "Games",
    "Media",
    "Security",
    "Communication",
  ],
  platforms: ["android", "windows", "macos", "linux", "web", "ios"],
};

const availablePlatforms = new Set(defaultSiteSettings.platforms);

export async function getSiteSettings(): Promise<SiteSettings> {
  const database = getDatabase();
  const result = await database.execute(
    "SELECT value_json FROM site_settings WHERE key = 'fdroid'",
  );
  const value = result.rows[0]?.value_json;
  if (typeof value !== "string") {
    throw new Error("F-Droid repository settings are missing. Run npm run db:init.");
  }
  const parsed: unknown = JSON.parse(value);
  if (
    !parsed ||
    typeof parsed !== "object" ||
    !("fdroidRepoUrl" in parsed) ||
    typeof parsed.fdroidRepoUrl !== "string" ||
    !("fdroidFingerprint" in parsed) ||
    typeof parsed.fdroidFingerprint !== "string"
  ) {
    throw new Error("F-Droid repository settings are invalid.");
  }
  const settings = parsed as Partial<SiteSettings>;
  if (
    typeof settings.fdroidRepoUrl !== "string" ||
    typeof settings.fdroidFingerprint !== "string"
  ) {
    throw new Error("F-Droid repository settings are invalid.");
  }
  if (
    (settings.categories !== undefined &&
      (!Array.isArray(settings.categories) ||
        !settings.categories.every((category) => typeof category === "string"))) ||
    (settings.platforms !== undefined &&
      (!Array.isArray(settings.platforms) ||
        !settings.platforms.every((platform) => typeof platform === "string")))
  ) {
    throw new Error("Catalog category and platform settings are invalid.");
  }
  return {
    fdroidRepoUrl: settings.fdroidRepoUrl,
    fdroidFingerprint: settings.fdroidFingerprint,
    categories: settings.categories ?? defaultSiteSettings.categories,
    platforms: settings.platforms ?? defaultSiteSettings.platforms,
  };
}

export async function saveSiteSettings(settings: SiteSettings): Promise<void> {
  await getDatabase().execute({
    sql: `INSERT INTO site_settings (key, value_json, updated_at)
      VALUES ('fdroid', ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value_json = excluded.value_json,
        updated_at = excluded.updated_at`,
    args: [JSON.stringify(settings), new Date().toISOString()],
  });
}

export function validateSiteSettings(value: unknown):
  | { settings: SiteSettings }
  | { error: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { error: "Repository settings must be a JSON object." };
  }
  const input = value as Record<string, unknown>;
  if (typeof input.fdroidRepoUrl !== "string") {
    return { error: "A repository URL is required." };
  }
  let repositoryUrl: URL;
  try {
    repositoryUrl = new URL(input.fdroidRepoUrl.trim());
  } catch {
    return { error: "Enter the full HTTPS URL of your F-Droid repository." };
  }
  if (
    repositoryUrl.protocol !== "https:" ||
    repositoryUrl.username ||
    repositoryUrl.password ||
    repositoryUrl.search ||
    repositoryUrl.hash
  ) {
    return { error: "The F-Droid repository address must be a clean HTTPS URL." };
  }
  if (
    typeof input.fdroidFingerprint !== "string" ||
    !/^(?:[A-Fa-f0-9]{64}|(?:[A-Fa-f0-9]{2}:){31}[A-Fa-f0-9]{2})$/.test(
      input.fdroidFingerprint.trim(),
    )
  ) {
    return { error: "Enter the repository's 64-character SHA-256 fingerprint." };
  }
  const categories = validateOptionList(input.categories, "category");
  if ("error" in categories) return categories;
  const platforms = validateOptionList(input.platforms, "platform");
  if ("error" in platforms) return platforms;
  if (platforms.values.length === 0) {
    return { error: "Keep at least one platform choice enabled." };
  }
  if (!platforms.values.every((platform) => availablePlatforms.has(platform))) {
    return { error: "Select from the supported platform choices." };
  }
  return {
    settings: {
      fdroidRepoUrl: repositoryUrl.toString().replace(/\/$/, ""),
      fdroidFingerprint: input.fdroidFingerprint
        .replaceAll(":", "")
        .trim()
        .toUpperCase(),
      categories: categories.values,
      platforms: platforms.values,
    },
  };
}

function validateOptionList(
  value: unknown,
  label: string,
): { values: string[] } | { error: string } {
  if (
    !Array.isArray(value) ||
    value.length > 40 ||
    !value.every(
      (item) =>
        typeof item === "string" &&
        item.trim().length > 0 &&
        item.trim().length <= 40 &&
        !/[\r\n]/.test(item),
    )
  ) {
    return { error: `Choose up to 40 valid ${label} options (40 characters each).` };
  }
  const values = [...new Map(value.map((item) => [item.trim().toLowerCase(), item.trim()])).values()];
  return { values };
}

export function getFdroidAddUrl(settings: SiteSettings): string {
  const repository = new URL(settings.fdroidRepoUrl);
  return `fdroidrepos://${repository.host}${repository.pathname}?fingerprint=${settings.fdroidFingerprint}`;
}
