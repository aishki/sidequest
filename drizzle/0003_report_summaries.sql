CREATE TYPE "public"."report_period" AS ENUM('week', 'month', 'quarter');--> statement-breakpoint
CREATE TABLE "report_summaries" (
	"period" "report_period" NOT NULL,
	"from_day" date NOT NULL,
	"body" text NOT NULL,
	"author" text DEFAULT 'claude' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "report_summaries_period_from_day_pk" PRIMARY KEY("period","from_day"),
	CONSTRAINT "report_summaries_body_not_blank" CHECK (length(trim("report_summaries"."body")) > 0)
);
