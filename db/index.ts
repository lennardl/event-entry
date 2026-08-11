import { neon } from "@neondatabase/serverless";

let client: ReturnType<typeof neon> | null = null;

export class DatabaseConfigurationError extends Error {
  constructor() {
    super("Database is not configured. Connect a Neon Postgres database and set DATABASE_URL.");
    this.name = "DatabaseConfigurationError";
  }
}

export function isDatabaseConfigured() {
  return Boolean(process.env.DATABASE_URL);
}

export function getSql() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new DatabaseConfigurationError();
  client ??= neon(connectionString, {
    fetchOptions: { cache: "no-store" },
  });
  return client;
}
