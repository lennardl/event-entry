ALTER TABLE "auth_magic_links" ADD COLUMN IF NOT EXISTS "provider_status" text;
--> statement-breakpoint
ALTER TABLE "auth_magic_links" ADD COLUMN IF NOT EXISTS "provider_error" text;
