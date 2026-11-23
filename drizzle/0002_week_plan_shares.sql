ALTER TABLE "week_plans" ADD COLUMN "saturday_project_id" integer;--> statement-breakpoint
ALTER TABLE "week_plans" ADD COLUMN "sunday_project_id" integer;--> statement-breakpoint
ALTER TABLE "week_plans" ADD COLUMN "shares" jsonb;--> statement-breakpoint
ALTER TABLE "week_plans" ADD CONSTRAINT "week_plans_saturday_project_id_projects_id_fk" FOREIGN KEY ("saturday_project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "week_plans" ADD CONSTRAINT "week_plans_sunday_project_id_projects_id_fk" FOREIGN KEY ("sunday_project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;