CREATE TABLE "rate_limit_windows" ("scope" text NOT NULL, "key_hash" text NOT NULL, "window_start" timestamptz NOT NULL, "count" integer DEFAULT 1 NOT NULL, PRIMARY KEY ("scope", "key_hash", "window_start"));
--> statement-breakpoint
CREATE TABLE "operational_events" ("id" text PRIMARY KEY NOT NULL, "category" text NOT NULL, "severity" text NOT NULL, "message" text NOT NULL, "detail" jsonb DEFAULT '{}'::jsonb NOT NULL, "created_at" timestamptz DEFAULT now() NOT NULL, "resolved_at" timestamptz);
--> statement-breakpoint
CREATE INDEX "operational_events_created_idx" ON "operational_events" ("created_at");
