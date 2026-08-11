CREATE TABLE "gate_access_links" (
  "id" text PRIMARY KEY NOT NULL,
  "gate_id" text NOT NULL REFERENCES "gates"("id") ON DELETE CASCADE,
  "token_hash" text NOT NULL UNIQUE,
  "expires_at" timestamp with time zone NOT NULL,
  "revoked_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "gate_access_links_gate_id_idx" ON "gate_access_links" USING btree ("gate_id");
