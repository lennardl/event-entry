ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "ticket_logo_data_url" text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "ticket_support_contact" text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "ticket_terms" text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "allow_e_tickets" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "allow_physical_tickets" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "allow_group_tickets" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "max_group_size" integer DEFAULT 6 NOT NULL;
--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "allow_ticket_regeneration" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE "gate_access_links" ADD COLUMN IF NOT EXISTS "label" text DEFAULT 'Gate device' NOT NULL;
--> statement-breakpoint
ALTER TABLE "gate_access_links" ADD COLUMN IF NOT EXISTS "last_used_at" timestamp with time zone;
