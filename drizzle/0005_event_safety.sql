ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "version" integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp with time zone;
