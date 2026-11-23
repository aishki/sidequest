CREATE TYPE "public"."ticket_priority" AS ENUM('low', 'normal', 'high', 'urgent');--> statement-breakpoint
CREATE TYPE "public"."ticket_status" AS ENUM('inbox', 'todo', 'in_progress', 'blocked', 'done');--> statement-breakpoint
CREATE TYPE "public"."ticket_type" AS ENUM('feature', 'bug', 'ui_ux', 'update', 'launch_film', 'research', 'admin');--> statement-breakpoint
CREATE TABLE "events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" text NOT NULL,
	"ticket_id" integer,
	"project_id" integer,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"prefix" text NOT NULL,
	"aliases" text[] DEFAULT '{}'::text[] NOT NULL,
	"color" text NOT NULL,
	"weekly_pct" numeric(6, 3) DEFAULT 0 NOT NULL,
	"is_overhead" boolean DEFAULT false NOT NULL,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	"next_number" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projects_prefix_unique" UNIQUE("prefix"),
	CONSTRAINT "projects_prefix_format" CHECK ("projects"."prefix" ~ '^[A-Z][A-Z0-9]{1,5}$'),
	CONSTRAINT "projects_color_format" CHECK ("projects"."color" ~ '^#[0-9a-f]{6}$'),
	CONSTRAINT "projects_weekly_pct_range" CHECK ("projects"."weekly_pct" between 0 and 100)
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subtasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"ticket_id" integer NOT NULL,
	"title" text NOT NULL,
	"done" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"done_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "tickets" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"number" integer NOT NULL,
	"title" text NOT NULL,
	"notes" text,
	"type" "ticket_type" DEFAULT 'feature' NOT NULL,
	"status" "ticket_status" DEFAULT 'inbox' NOT NULL,
	"priority" "ticket_priority" DEFAULT 'normal' NOT NULL,
	"estimate_min" integer,
	"due_on" date,
	"planned_on" date,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"done_at" timestamp with time zone,
	CONSTRAINT "tickets_title_not_blank" CHECK (length(trim("tickets"."title")) > 0),
	CONSTRAINT "tickets_estimate_positive" CHECK ("tickets"."estimate_min" is null or "tickets"."estimate_min" > 0)
);
--> statement-breakpoint
CREATE TABLE "time_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"ticket_id" integer,
	"project_id" integer NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"note" text,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "time_entries_order" CHECK ("time_entries"."ended_at" is null or "time_entries"."ended_at" > "time_entries"."started_at"),
	CONSTRAINT "time_entries_source" CHECK ("time_entries"."source" in ('chat', 'timer'))
);
--> statement-breakpoint
CREATE TABLE "week_plans" (
	"week_start" date PRIMARY KEY NOT NULL,
	"saturday_hours" numeric(4, 2) DEFAULT 0 NOT NULL,
	"sunday_hours" numeric(4, 2) DEFAULT 0 NOT NULL,
	"note" text,
	CONSTRAINT "week_plans_monday" CHECK (extract(isodow from "week_plans"."week_start") = 1)
);
--> statement-breakpoint
ALTER TABLE "subtasks" ADD CONSTRAINT "subtasks_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "events_at" ON "events" USING btree ("at");--> statement-breakpoint
CREATE INDEX "events_ticket" ON "events" USING btree ("ticket_id");--> statement-breakpoint
CREATE INDEX "subtasks_ticket" ON "subtasks" USING btree ("ticket_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tickets_project_number" ON "tickets" USING btree ("project_id","number");--> statement-breakpoint
CREATE INDEX "tickets_status" ON "tickets" USING btree ("status");--> statement-breakpoint
CREATE INDEX "tickets_planned_on" ON "tickets" USING btree ("planned_on");--> statement-breakpoint
CREATE INDEX "time_entries_started_at" ON "time_entries" USING btree ("started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "time_entries_one_running" ON "time_entries" USING btree ((true)) WHERE "time_entries"."ended_at" is null;