import { existsSync } from "node:fs";
import { createClient } from "@libsql/client";

if (existsSync(".env")) process.loadEnvFile(".env");

const url = process.env.TURSO_DATABASE_URL ?? "file:./local.db";
const authToken = process.env.TURSO_AUTH_TOKEN;
if (url.startsWith("file:") && authToken) {
  throw new Error("TURSO_AUTH_TOKEN must not be set when initializing a local SQLite database.");
}
if (!url.startsWith("file:") && !authToken) {
  throw new Error("TURSO_AUTH_TOKEN is required when TURSO_DATABASE_URL is remote.");
}

const client = createClient({
  url,
  ...(authToken ? { authToken } : {}),
});

try {
  await client.executeMultiple(`
    CREATE TABLE IF NOT EXISTS apps (
      slug TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      is_featured INTEGER NOT NULL DEFAULT 0,
      record_json TEXT NOT NULL CHECK (json_valid(record_json)),
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_apps_featured_name
      ON apps (is_featured DESC, name COLLATE NOCASE ASC);
    CREATE TABLE IF NOT EXISTS site_settings (
      key TEXT PRIMARY KEY NOT NULL,
      value_json TEXT NOT NULL CHECK (json_valid(value_json)),
      updated_at TEXT NOT NULL
    );
  `);

  await client.execute({
    sql: `INSERT OR IGNORE INTO site_settings (key, value_json, updated_at)
      VALUES ('fdroid', ?, ?)`,
    args: [
      JSON.stringify({
        fdroidRepoUrl:
          "https://devcat-exe.github.io/devcat-fdroid-repo/repo",
        fdroidFingerprint:
          "2DF393D82A16ACDA06DDECAE7870001786EF1077921151F291C7D0A326AF127E",
      }),
      new Date().toISOString(),
    ],
  });
  console.log(`Initialized ${url}; existing app records were left unchanged.`);
} finally {
  client.close();
}
