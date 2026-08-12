CREATE TABLE "auth_users" ("email" text PRIMARY KEY NOT NULL, "role" text NOT NULL, "enabled" boolean DEFAULT true NOT NULL, "session_version" integer DEFAULT 1 NOT NULL, "created_at" timestamptz DEFAULT now() NOT NULL, "updated_at" timestamptz DEFAULT now() NOT NULL, "last_login_at" timestamptz);
--> statement-breakpoint
CREATE TABLE "auth_login_history" ("id" text PRIMARY KEY NOT NULL, "email" text NOT NULL, "success" boolean NOT NULL, "reason" text NOT NULL, "requester_hash" text, "created_at" timestamptz DEFAULT now() NOT NULL);
