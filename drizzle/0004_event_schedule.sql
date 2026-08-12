ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "start_date" date DEFAULT CURRENT_DATE NOT NULL;
--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "end_date" date DEFAULT CURRENT_DATE NOT NULL;
--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "time_zone" text DEFAULT 'Asia/Singapore' NOT NULL;
--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "doors_open" text DEFAULT '15:00' NOT NULL;
--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "event_end" text DEFAULT '23:00' NOT NULL;
--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_date_order" CHECK (end_date >= start_date) NOT VALID;
