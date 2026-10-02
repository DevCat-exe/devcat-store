import { existsSync } from "node:fs";
import { createClient } from "@libsql/client";

if (existsSync(".env")) process.loadEnvFile(".env");

const databaseUrl = process.env.TURSO_DATABASE_URL ?? "file:./local.db";
const authToken = process.env.TURSO_AUTH_TOKEN;

if (databaseUrl.startsWith("file:") && authToken) {
  throw new Error("TURSO_AUTH_TOKEN must not be set when syncing to local SQLite.");
}
if (!databaseUrl.startsWith("file:") && !authToken) {
  throw new Error(
    "TURSO_AUTH_TOKEN is required when TURSO_DATABASE_URL points to a remote database.",
  );
}

const database = createClient({
  url: databaseUrl,
  ...(authToken ? { authToken } : {}),
});

async function fetchJson(url, description) {
  const response = await fetch(url, {
    headers: { "user-agent": "Devcat-App-Catalog-FDroid-Sync" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`${description} failed (${response.status}): ${detail.slice(0, 600)}`);
  }
  return response.json();
}

async function fetchOptionalText(url) {
  const response = await fetch(url, {
    headers: { "user-agent": "Devcat-App-Catalog-FDroid-Sync" },
    signal: AbortSignal.timeout(20_000),
  });
  if (response.status === 404) return "";
  if (!response.ok) {
    throw new Error(`F-Droid changelog request failed (${response.status}): ${url}`);
  }
  return response.text();
}

function getLocalizedMetadata(app) {
  const localized = app.localized;
  if (!localized || typeof localized !== "object") return {};
  return localized["en-US"] ??
    Object.values(localized).find((item) => item && typeof item === "object") ??
    {};
}

function githubRepository(value) {
  if (typeof value !== "string") return "";
  try {
    const parsed = new URL(value);
    if (parsed.hostname.toLowerCase() !== "github.com") return "";
    const [owner, repository] = parsed.pathname.split("/").filter(Boolean);
    return owner && repository
      ? `${owner}/${repository.replace(/\.git$/i, "")}`
      : "";
  } catch {
    return "";
  }
}

function githubPagesMetadataBase(repositoryUrl, packageName, locale) {
  const parsed = new URL(repositoryUrl);
  const owner = parsed.hostname.match(/^([a-z0-9-]+)\.github\.io$/i)?.[1];
  const repository = parsed.pathname.split("/").filter(Boolean)[0];
  if (!owner || !repository) return "";
  return `https://raw.githubusercontent.com/${owner}/${repository}/main/fdroid/metadata/${encodeURIComponent(packageName)}/${encodeURIComponent(locale)}`;
}

function cleanDescription(value) {
  if (typeof value !== "string") return "";
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|li|h[1-6])\s*>/gi, "\n\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function versionKey(version) {
  return String(version ?? "").replace(/^v/i, "").toLowerCase();
}

function makeSlug(name, packageName, usedSlugs) {
  const base =
    name
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 70) || "app";
  if (!usedSlugs.has(base)) return base;
  const suffix = packageName.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return `${base}-${suffix}`.slice(0, 80);
}

function androidVersion(minSdk) {
  const versions = {
    24: "7.0",
    25: "7.1",
    26: "8.0",
    27: "8.1",
    28: "9",
    29: "10",
    30: "11",
    31: "12",
    32: "12L",
    33: "13",
    34: "14",
    35: "15",
    36: "16",
  };
  const api = Number(minSdk);
  return Number.isFinite(api)
    ? `Android ${versions[api] ?? `API ${api}`}+`
    : "";
}

function getPermissionNames(permissions) {
  if (!Array.isArray(permissions)) return [];
  return [
    ...new Set(
      permissions
        .map((permission) =>
          Array.isArray(permission) && typeof permission[0] === "string"
            ? permission[0].replace(/^android\.permission\./, "")
            : "",
        )
        .filter(Boolean),
    ),
  ];
}

function appMatchesRecord(record, fdroidApp, packageName) {
  if (record.fdroidPackageName === packageName) return true;
  const sourceRepo = githubRepository(fdroidApp.sourceCode);
  return Boolean(
    sourceRepo &&
      record.githubRepo &&
      sourceRepo.toLowerCase() === record.githubRepo.toLowerCase(),
  );
}

try {
  const settingResult = await database.execute(
    "SELECT value_json FROM site_settings WHERE key = 'fdroid'",
  );
  const settingsText = settingResult.rows[0]?.value_json;
  if (typeof settingsText !== "string") {
    throw new Error("F-Droid settings are missing; run npm run db:init first.");
  }
  const settings = JSON.parse(settingsText);
  if (typeof settings.fdroidRepoUrl !== "string") {
    throw new Error("F-Droid repository settings do not contain a valid URL.");
  }
  const repoUrl = settings.fdroidRepoUrl.replace(/\/+$/, "");
  const indexUrl = new URL("index-v1.json", `${repoUrl}/`).toString();
  const index = await fetchJson(indexUrl, "F-Droid index request");
  if (!Array.isArray(index.apps) || !index.packages || typeof index.packages !== "object") {
    throw new Error("The F-Droid index is missing its apps or packages data.");
  }

  const rows = await database.execute(
    "SELECT slug, record_json FROM apps ORDER BY name COLLATE NOCASE ASC",
  );
  const records = rows.rows.map((row) => {
    if (typeof row.record_json !== "string") {
      throw new Error(`Catalog row "${row.slug}" has invalid app data.`);
    }
    return JSON.parse(row.record_json);
  });
  const usedSlugs = new Set(records.map((record) => record.slug));
  let synced = 0;

  for (const fdroidApp of index.apps) {
    const packageName = fdroidApp.packageName;
    if (typeof packageName !== "string" || !Array.isArray(index.packages[packageName])) {
      continue;
    }
    const localized = getLocalizedMetadata(fdroidApp);
    const name =
      typeof localized.name === "string" && localized.name.trim()
        ? localized.name.trim()
        : packageName;
    const packageVersions = index.packages[packageName]
      .filter(
        (item) =>
          item &&
          typeof item.apkName === "string" &&
          typeof item.versionName === "string",
      )
      .sort((a, b) => Number(b.versionCode) - Number(a.versionCode));
    const latest = packageVersions[0];
    if (!latest) continue;

    const locale = Object.keys(fdroidApp.localized ?? {}).find(
      (key) => fdroidApp.localized[key] === localized,
    ) ?? "en-US";
    const metadataBase = githubPagesMetadataBase(repoUrl, packageName, locale);
    const fallbackIcon = localized.icon
      ? new URL(`icons/${encodeURIComponent(localized.icon)}`, `${repoUrl}/`).toString()
      : "";
    const icon = metadataBase ? `${metadataBase}/icon.png` : fallbackIcon;
    const screenshots = Array.isArray(localized.phoneScreenshots)
      ? localized.phoneScreenshots
          .filter((item) => typeof item === "string" && item.length <= 240)
          .map((item) =>
            metadataBase
              ? `${metadataBase}/phoneScreenshots/${encodeURIComponent(item)}`
              : new URL(encodeURIComponent(item), `${repoUrl}/`).toString(),
          )
      : [];
    const apkUrl = new URL(encodeURIComponent(latest.apkName), `${repoUrl}/`).toString();
    const sourceUrl =
      typeof fdroidApp.sourceCode === "string" ? fdroidApp.sourceCode : "";
    const githubRepo = githubRepository(sourceUrl);
    const existing = records.find((record) =>
      appMatchesRecord(record, fdroidApp, packageName),
    );
    const slug = existing?.slug ?? makeSlug(name, packageName, usedSlugs);
    usedSlugs.add(slug);
    const versionEntries = await Promise.all(
      packageVersions.slice(0, 30).map(async (item) => {
        const versionCode = Number(item.versionCode) || 0;
        const changelogUrl =
          metadataBase && /^\d+$/.test(String(item.versionCode))
            ? `${metadataBase}/changelogs/${encodeURIComponent(item.versionCode)}.txt`
            : "";
        const notes = changelogUrl ? await fetchOptionalText(changelogUrl) : "";
        const sizeBytes = Number(item.size) || 0;
        return {
          version: item.versionName,
          tag: item.versionName,
          versionCode,
          publishedAt: "",
          url: new URL(encodeURIComponent(item.apkName), `${repoUrl}/`).toString(),
          notes,
          isPrerelease: false,
          source: "fdroid",
          sizeBytes,
          fdroidUrl: new URL(encodeURIComponent(item.apkName), `${repoUrl}/`).toString(),
          fdroidSizeBytes: sizeBytes,
          assets: [{
            name: item.apkName,
            url: new URL(encodeURIComponent(item.apkName), `${repoUrl}/`).toString(),
            size: sizeBytes,
            downloadCount: 0,
            source: "fdroid",
            sha256:
              typeof item.hash === "string" && /^[a-f0-9]{64}$/i.test(item.hash)
                ? item.hash.toLowerCase()
                : "",
          }],
          fdroidSha256:
            typeof item.hash === "string" && /^[a-f0-9]{64}$/i.test(item.hash)
              ? item.hash.toLowerCase()
              : "",
          sha256:
            typeof item.hash === "string" && /^[a-f0-9]{64}$/i.test(item.hash)
              ? item.hash.toLowerCase()
              : "",
        };
      }),
    );
    const previousHistory = Array.isArray(existing?.releaseHistory)
      ? existing.releaseHistory
      : [];
    const historyByVersion = new Map(
      previousHistory.map((entry) => [versionKey(entry.version), entry]),
    );
    for (const entry of versionEntries) {
      const previous = historyByVersion.get(versionKey(entry.version));
      historyByVersion.set(versionKey(entry.version), {
        ...entry,
        ...previous,
        notes: previous?.notes || entry.notes,
        sha256:
          previous?.source === "github"
            ? previous.githubSha256 ?? ""
            : entry.sha256,
        fdroidUrl: entry.fdroidUrl,
        fdroidSizeBytes: entry.fdroidSizeBytes,
        fdroidSha256: entry.fdroidSha256,
        assets: [
          ...(previous?.assets ?? []).filter((asset) => asset.source !== "fdroid"),
          ...entry.assets,
        ],
        sizeBytes: previous?.sizeBytes || entry.sizeBytes,
        versionCode: previous?.versionCode || entry.versionCode,
      });
    }
    const releaseHistory = [...historyByVersion.values()].sort(
      (a, b) => Number(b.versionCode) - Number(a.versionCode),
    );
    const sizeBytes = Number(latest.size) || 0;
    const record = {
      id: slug,
      ...existing,
      slug,
      name: existing?.name || name,
      summary:
        existing?.summary ||
        (typeof localized.summary === "string" ? localized.summary : ""),
      description:
        existing?.description ||
        cleanDescription(localized.description ?? ""),
      version: latest.versionName,
      size: sizeBytes ? `${(sizeBytes / 1024 / 1024).toFixed(1)} MB` : "",
      sizeBytes,
      platforms: existing?.platforms?.length ? existing.platforms : ["android"],
      categories: Array.isArray(fdroidApp.categories)
        ? fdroidApp.categories.filter((item) => typeof item === "string")
        : [],
      icon: icon || existing?.icon || "",
      screenshots: screenshots.length ? screenshots : existing?.screenshots ?? [],
      downloadUrl: apkUrl,
      availableOnFdroid: true,
      fdroidPackageName: packageName,
      playStoreUrl: existing?.playStoreUrl ?? "",
      sourceUrl: existing?.sourceUrl || sourceUrl,
      license:
        typeof fdroidApp.license === "string"
          ? fdroidApp.license
          : existing?.license ?? "",
      lastUpdated: existing?.lastUpdated ?? "",
      githubRepo: existing?.githubRepo || githubRepo,
      androidMinVersion: androidVersion(latest.minSdkVersion),
      permissions: getPermissionNames(latest["uses-permission"]),
      releaseTag: existing?.githubRepo
        ? existing.releaseTag ?? ""
        : latest.versionName,
      releaseUrl:
        existing?.releaseUrl ||
        (typeof fdroidApp.changelog === "string" ? fdroidApp.changelog : ""),
      releaseNotes:
        existing?.githubRepo
          ? existing.releaseNotes ?? ""
          : versionEntries[0]?.notes || localized.whatsNew || "",
      releasePublishedAt: existing?.releasePublishedAt ?? "",
      releaseIsPrerelease: existing?.releaseIsPrerelease ?? false,
      releaseHistory,
      releaseAssets: existing?.githubRepo
        ? existing.releaseAssets ?? []
        : [
            {
              name: latest.apkName,
              url: apkUrl,
              size: sizeBytes,
              downloadCount: 0,
              sha256:
                typeof latest.hash === "string" ? latest.hash.toLowerCase() : "",
            },
          ],
      releaseDownloadsCount: existing?.releaseDownloadsCount ?? 0,
      isFeatured: existing?.isFeatured ?? false,
      privacyPolicy: existing?.privacyPolicy ?? "",
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
    if (!existing) records.push(record);
    console.log(
      `${record.name}: F-Droid ${record.version} · ${releaseHistory.length} version(s)`,
    );
    synced += 1;
  }

  console.log(`Synced ${synced} app(s) from the F-Droid repository.`);
} finally {
  database.close();
}
