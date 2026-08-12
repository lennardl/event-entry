ALTER TABLE "auth_magic_links" ADD COLUMN IF NOT EXISTS "failed_attempts" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "auth_magic_links" ADD CONSTRAINT "auth_magic_links_failed_attempts_nonnegative" CHECK ("failed_attempts" >= 0);
--> statement-breakpoint
DROP INDEX IF EXISTS "auth_magic_links_token_hash_idx";
--> statement-breakpoint
CREATE INDEX "auth_login_code_hash_idx" ON "auth_magic_links" USING btree ("token_hash");
