ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "ticket_brand" text DEFAULT 'Event Entry' NOT NULL;
--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "ticket_title" text DEFAULT 'Official admission ticket' NOT NULL;
--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "ticket_instructions" text DEFAULT 'Present this QR at any entry gate. Turn your screen brightness up if needed.' NOT NULL;
--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "ticket_primary_colour" text DEFAULT '#17213a' NOT NULL;
--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "ticket_accent_colour" text DEFAULT '#dc162f' NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tickets_event_nric_idx" ON "tickets" USING btree ("event_id", "nric_hash");
--> statement-breakpoint
UPDATE "events" SET "status" = 'live' WHERE "status" NOT IN ('draft', 'live', 'closed', 'archived');
