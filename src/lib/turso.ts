import { createClient, type Client } from "@libsql/client";

const localDatabaseUrl = "file:./local.db";
let database: Client | undefined;

export function getDatabase(): Client {
  if (database) return database;

  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  const isProduction = import.meta.env.PROD;

  if (isProduction && (!url || !authToken)) {
    throw new Error(
      "TURSO_DATABASE_URL and TURSO_AUTH_TOKEN must be configured in the production environment.",
    );
  }
  if (url && !authToken && !url.startsWith("file:")) {
    throw new Error("TURSO_AUTH_TOKEN is required when TURSO_DATABASE_URL is remote.");
  }

  database = createClient({
    url: url ?? localDatabaseUrl,
    ...(authToken ? { authToken } : {}),
  });
  return database;
}
