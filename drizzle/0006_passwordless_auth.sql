CREATE TABLE "auth_magic_links" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"role" text NOT NULL,
	"token_hash" text NOT NULL,
	"requester_hash" text NOT NULL,
	"provider_message_id" text,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_magic_links_role_valid" CHECK ("role" in ('Super Admin', 'Admin', 'Gate Supervisor', 'Command Centre Viewer'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "auth_magic_links_token_hash_idx" ON "auth_magic_links" USING btree ("token_hash");
--> statement-breakpoint
CREATE INDEX "auth_magic_links_email_created_idx" ON "auth_magic_links" USING btree ("email", "created_at");
--> statement-breakpoint
CREATE INDEX "auth_magic_links_requester_created_idx" ON "auth_magic_links" USING btree ("requester_hash", "created_at");
--> statement-breakpoint
CREATE INDEX "auth_magic_links_expiry_idx" ON "auth_magic_links" USING btree ("expires_at");
