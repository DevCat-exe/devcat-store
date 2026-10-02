import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { createClient } from "@libsql/client";

if (existsSync(".env")) process.loadEnvFile(".env");

const databaseUrl = process.env.TURSO_DATABASE_URL ?? "file:./local.db";
const authToken = process.env.TURSO_AUTH_TOKEN;
const githubToken = process.env.GITHUB_TOKEN;
const maxChecksumBytes = 512 * 1024 * 1024;

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

async function readResponse(response, description) {
  if (response.ok) return response.json();
  const detail = await response.text();
  throw new Error(`${description} failed (${response.status}): ${detail.slice(0, 800)}`);
}

async function githubRequest(url) {
  const response = await fetch(url, {
    headers: {
      accept: "application/vnd.github+json",
      "user-agent": "Devcat-App-Catalog-Release-Sync",
      "x-github-api-version": "2022-11-28",
      ...(githubToken ? { authorization: `Bearer ${githubToken}` } : {}),
    },
    signal: AbortSignal.timeout(30_000),
  });
  return readResponse(response, `GitHub request ${url}`);
}

function validateRepository(value) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value)) {
    throw new Error(`Invalid GitHub repository "${value}". Use owner/repository.`);
  }
  return value.split("/").map(encodeURIComponent);
}

function isInstallableAsset(asset) {
  return /\.(apk|aab|exe|msi|dmg|appimage|deb|rpm|zip|tar\.gz)$/i.test(asset.name);
}

function choosePrimaryAsset(assets, platforms = []) {
  const preferred = platforms.includes("android")
    ? [".apk", ".aab"]
    : [".msi", ".exe", ".dmg", ".appimage", ".deb", ".rpm", ".zip", ".tar.gz"];
  for (const extension of preferred) {
    const asset = assets.find((item) => item.name.toLowerCase().endsWith(extension));
    if (asset) return asset;
  }
  return assets[0];
}

function checksumFromFile(text, fileName) {
  for (const line of text.split(/\r?\n/)) {
    const match = line.trim().match(/^([a-f0-9]{64})\s+\*?(.+?)\s*$/i);
    if (match && match[2] === fileName) return match[1].toLowerCase();
  }
  return "";
}

async function getPublishedChecksums(releaseAssets) {
  const checksumAsset = releaseAssets.find((asset) =>
    /\.(sha256|sha256sum|sha256sums|sha256\.txt)$/i.test(asset.name),
  );
  if (!checksumAsset) return new Map();

  const response = await fetch(checksumAsset.browser_download_url, {
    headers: { "user-agent": "Devcat-App-Catalog-Release-Sync" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`Could not download ${checksumAsset.name} (${response.status}).`);
  }
  const text = await response.text();
  return new Map(
    releaseAssets
      .filter(isInstallableAsset)
      .map((asset) => [asset.name, checksumFromFile(text, asset.name)]),
  );
}

async function calculateSha256(url, name, size) {
  if (size > maxChecksumBytes) {
    console.warn(`Skipping checksum for ${name}: file exceeds the 512 MiB safety limit.`);
    return "";
  }
  const response = await fetch(url, {
    headers: { "user-agent": "Devcat-App-Catalog-Release-Sync" },
    signal: AbortSignal.timeout(180_000),
  });
  if (!response.ok || !response.body) {
    throw new Error(`Could not download ${name} to calculate its SHA-256 (${response.status}).`);
  }

  const hash = createHash("sha256");
  const reader = response.body.getReader();
  let bytesRead = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytesRead += value.byteLength;
    if (bytesRead > maxChecksumBytes) {
      await reader.cancel();
      console.warn(`Skipping checksum for ${name}: file exceeded the 512 MiB safety limit.`);
      return "";
    }
    hash.update(value);
  }
  return hash.digest("hex");
}

function displaySize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  const megabytes = bytes / (1024 * 1024);
  return `${megabytes < 100 ? megabytes.toFixed(1) : Math.round(megabytes)} MB`;
}

function detectPlatforms(assets) {
  const platforms = new Set();
  for (const asset of assets) {
    const name = asset.name.toLowerCase();
    if (/\.(apk|aab)$/i.test(name)) platforms.add("android");
    if (/windows|\.(exe|msi)$/i.test(name)) platforms.add("windows");
    if (/macos|osx|\.dmg$|\.pkg$/i.test(name)) platforms.add("macos");
    if (/linux|\.appimage$|\.deb$|\.rpm$/i.test(name)) platforms.add("linux");
  }
  return [...platforms];
}

async function syncApp(app) {
  const [owner, repository] = validateRepository(app.githubRepo);
  const release = await githubRequest(
    `https://api.github.com/repos/${owner}/${repository}/releases/latest`,
  );
  const allReleases = await githubRequest(
    `https://api.github.com/repos/${owner}/${repository}/releases?per_page=100`,
  );
  if (!Array.isArray(release.assets)) {
    throw new Error(`GitHub returned an invalid release response for ${app.githubRepo}.`);
  }
  if (!Array.isArray(allReleases)) {
    throw new Error(`GitHub returned invalid release history for ${app.githubRepo}.`);
  }

  const binaryAssets = release.assets.filter(isInstallableAsset);
  const primaryAsset = choosePrimaryAsset(binaryAssets, app.platforms);
  const checksums = await getPublishedChecksums(release.assets);
  const releaseAssets = [];
  const historyByVersion = new Map(
    (Array.isArray(app.releaseHistory) ? app.releaseHistory : []).map((entry) => [
      String(entry.version ?? "").replace(/^v/i, "").toLowerCase(),
      entry,
    ]),
  );
  for (const item of allReleases) {
    if (typeof item.tag_name !== "string" || !Array.isArray(item.assets)) continue;
    const version = item.tag_name.replace(/^v/i, "");
    const key = version.toLowerCase();
    const previous = historyByVersion.get(key);
    const primary = choosePrimaryAsset(
      item.assets.filter(isInstallableAsset),
      app.platforms,
    );
    const githubAssets = item.assets
      .filter(isInstallableAsset)
      .map((asset) => ({
        name: asset.name,
        url: asset.browser_download_url,
        size: Number(asset.size) || 0,
        downloadCount: Number(asset.download_count) || 0,
        source: "github",
        sha256:
          typeof asset.digest === "string" && asset.digest.startsWith("sha256:")
            ? asset.digest.slice(7).toLowerCase()
            : (previous?.assets ?? []).find(
                (existing) =>
                  existing.source === "github" && existing.name === asset.name,
              )?.sha256 ?? "",
      }));
    historyByVersion.set(key, {
      ...previous,
      version,
      tag: item.tag_name,
      versionCode: previous?.versionCode ?? 0,
      publishedAt: item.published_at?.slice(0, 10) ?? previous?.publishedAt ?? "",
      url: item.html_url ?? previous?.url ?? "",
      notes: item.body || previous?.notes || "",
      isPrerelease: Boolean(item.prerelease),
      source: "github",
      sizeBytes: primary?.size ?? previous?.sizeBytes ?? 0,
      sha256:
        (typeof primary?.digest === "string" && primary.digest.startsWith("sha256:")
          ? primary.digest.slice(7).toLowerCase()
          : "") ||
        previous?.githubSha256 ||
        (previous?.source === "github" ? previous.sha256 : "") ||
        "",
      githubSha256:
        (typeof primary?.digest === "string" && primary.digest.startsWith("sha256:")
          ? primary.digest.slice(7).toLowerCase()
          : "") ||
        previous?.githubSha256 ||
        "",
      assets: [
        ...(previous?.assets ?? []).filter((asset) => asset.source !== "github"),
        ...githubAssets,
      ],
    });
  }
  const releaseHistory = [...historyByVersion.values()].sort((a, b) => {
    const dateDifference =
      Date.parse(b.publishedAt || "") - Date.parse(a.publishedAt || "");
    if (Number.isFinite(dateDifference) && dateDifference !== 0) {
      return dateDifference;
    }
    return (Number(b.versionCode) || 0) - (Number(a.versionCode) || 0);
  });

  for (const asset of binaryAssets) {
    const apiDigest =
      typeof asset.digest === "string" && asset.digest.startsWith("sha256:")
        ? asset.digest.slice(7).toLowerCase()
        : "";
    const sha256 =
      apiDigest ||
      checksums.get(asset.name) ||
      (asset === primaryAsset
        ? await calculateSha256(asset.browser_download_url, asset.name, asset.size)
        : "");
    releaseAssets.push({
      name: asset.name,
      url: asset.browser_download_url,
      size: asset.size,
      downloadCount: asset.download_count,
      sha256,
    });
  }
  const latestHistory = historyByVersion.get(
    String(release.tag_name ?? "").replace(/^v/i, "").toLowerCase(),
  );
  if (latestHistory) {
    latestHistory.assets = [
      ...(latestHistory.assets ?? []).filter((asset) => asset.source !== "github"),
      ...releaseAssets.map((asset) => ({ ...asset, source: "github" })),
    ];
  }

  const publishedAt = release.published_at ?? "";
  const publishedDate = publishedAt ? publishedAt.slice(0, 10) : "";
  const updates = {
    platforms: [...new Set([...app.platforms, ...detectPlatforms(binaryAssets)])],
    version: String(release.tag_name ?? "").replace(/^v/i, ""),
    releaseTag: release.tag_name ?? "",
    releaseUrl: release.html_url ?? "",
    releaseNotes: release.body ?? "",
    releasePublishedAt: publishedDate,
    releaseIsPrerelease: false,
    releaseHistory,
    lastUpdated: publishedDate || app.lastUpdated,
    releaseAssets,
    releaseDownloadsCount: release.assets.reduce(
      (total, asset) => total + (Number(asset.download_count) || 0),
      0,
    ),
    ...(primaryAsset
      ? {
          downloadUrl: primaryAsset.browser_download_url,
          sizeBytes: primaryAsset.size,
          size: displaySize(primaryAsset.size),
        }
      : {}),
  };
  const record = { ...app, ...updates };

  const result = await database.execute({
    sql: `UPDATE apps SET record_json = ?, updated_at = ?
      WHERE slug = ?`,
    args: [JSON.stringify(record), new Date().toISOString(), app.slug],
  });
  if (result.rowsAffected !== 1) {
    throw new Error(`The database record for ${app.name} changed during release sync.`);
  }

  console.log(
    `${app.name}: ${record.releaseTag || "release"} · ${binaryAssets.length} file(s) · ${record.releaseDownloadsCount} downloads`,
  );
}

try {
  const result = await database.execute(
    "SELECT record_json FROM apps ORDER BY name COLLATE NOCASE ASC",
  );
  const apps = result.rows.map((row) => {
    if (typeof row.record_json !== "string") {
      throw new Error("The app database contains an invalid catalog record.");
    }
    return JSON.parse(row.record_json);
  });
  const syncableApps = apps.filter((app) => app.githubRepo);

  if (!syncableApps.length) {
    console.log("No apps have a GitHub repository configured; nothing to sync.");
  }

  const failures = [];
  for (const app of syncableApps) {
    try {
      await syncApp(app);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`${app.name}: ${message}`);
      console.error(`Release sync failed for ${app.name}: ${message}`);
    }
  }
  if (failures.length) throw new Error(`${failures.length} release sync(s) failed.`);
} finally {
  database.close();
}
