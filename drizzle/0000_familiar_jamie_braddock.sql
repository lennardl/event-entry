CREATE TABLE "audit_events" (
	"id" text PRIMARY KEY NOT NULL,
	"action" text NOT NULL,
	"actor" text NOT NULL,
	"subject_id" text NOT NULL,
	"detail" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"venue" text NOT NULL,
	"status" text NOT NULL,
	"capacity" integer NOT NULL,
	"entry_window_start" text NOT NULL,
	"entry_window_end" text NOT NULL,
	CONSTRAINT "events_capacity_nonnegative" CHECK ("events"."capacity" >= 0)
);
--> statement-breakpoint
CREATE TABLE "gates" (
	"id" text PRIMARY KEY NOT NULL,
	"event_id" text NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scan_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"fingerprint" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scans" (
	"id" text PRIMARY KEY NOT NULL,
	"ticket_id" text NOT NULL,
	"event_id" text NOT NULL,
	"gate_id" text NOT NULL,
	"quantity" integer NOT NULL,
	"result" text NOT NULL,
	"mode" text NOT NULL,
	"reason" text,
	"operator" text NOT NULL,
	"remaining_after" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scans_quantity_positive" CHECK ("scans"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "tickets" (
	"id" text PRIMARY KEY NOT NULL,
	"event_id" text NOT NULL,
	"nric_hash" text NOT NULL,
	"masked_nric" text NOT NULL,
	"mobile" text NOT NULL,
	"zone_id" text NOT NULL,
	"format" text NOT NULL,
	"max_entries" integer NOT NULL,
	"used_entries" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"token" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	CONSTRAINT "tickets_entry_range" CHECK ("tickets"."max_entries" between 1 and 6 and "tickets"."used_entries" between 0 and "tickets"."max_entries"),
	CONSTRAINT "tickets_format_valid" CHECK ("tickets"."format" in ('e-ticket', 'physical'))
);
--> statement-breakpoint
CREATE TABLE "zones" (
	"id" text PRIMARY KEY NOT NULL,
	"event_id" text NOT NULL,
	"name" text NOT NULL,
	"colour" text NOT NULL,
	"capacity" integer NOT NULL,
	CONSTRAINT "zones_capacity_nonnegative" CHECK ("zones"."capacity" >= 0)
);
--> statement-breakpoint
ALTER TABLE "gates" ADD CONSTRAINT "gates_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scans" ADD CONSTRAINT "scans_id_scan_requests_id_fk" FOREIGN KEY ("id") REFERENCES "public"."scan_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scans" ADD CONSTRAINT "scans_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scans" ADD CONSTRAINT "scans_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scans" ADD CONSTRAINT "scans_gate_id_gates_id_fk" FOREIGN KEY ("gate_id") REFERENCES "public"."gates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_zone_id_zones_id_fk" FOREIGN KEY ("zone_id") REFERENCES "public"."zones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zones" ADD CONSTRAINT "zones_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_events_created_idx" ON "audit_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "gates_event_id_idx" ON "gates" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "scan_requests_created_idx" ON "scan_requests" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "scans_event_created_idx" ON "scans" USING btree ("event_id","created_at");--> statement-breakpoint
CREATE INDEX "scans_ticket_id_idx" ON "scans" USING btree ("ticket_id");--> statement-breakpoint
CREATE INDEX "tickets_event_id_idx" ON "tickets" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "tickets_nric_hash_idx" ON "tickets" USING btree ("nric_hash");--> statement-breakpoint
CREATE INDEX "tickets_zone_id_idx" ON "tickets" USING btree ("zone_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tickets_token_idx" ON "tickets" USING btree ("token");--> statement-breakpoint
CREATE INDEX "zones_event_id_idx" ON "zones" USING btree ("event_id");