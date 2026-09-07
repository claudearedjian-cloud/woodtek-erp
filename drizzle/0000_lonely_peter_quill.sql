CREATE TABLE "assets" (
	"id" serial PRIMARY KEY NOT NULL,
	"asset_tag" text NOT NULL,
	"name" text NOT NULL,
	"brand" text DEFAULT 'Generic' NOT NULL,
	"asset_type" text DEFAULT 'Generators' NOT NULL,
	"site" text DEFAULT 'Main Plant Bay A' NOT NULL,
	"machine_id" integer,
	"runtime_hours" integer DEFAULT 0 NOT NULL,
	"service_interval_hours" integer DEFAULT 500 NOT NULL,
	"last_service_hours" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'Operational' NOT NULL,
	"criticality" text DEFAULT 'Medium' NOT NULL,
	"serial_number" text,
	"installed_at" timestamp,
	"notes" text,
	"series" text,
	"production_year" integer,
	"image_url" text,
	"power_status" text DEFAULT 'Standby' NOT NULL,
	"load_output_percent" integer DEFAULT 0 NOT NULL,
	"fuel_reserve_percent" integer DEFAULT 100 NOT NULL,
	"oil_pressure_bar" numeric DEFAULT '0.0' NOT NULL,
	"rating_kva" integer DEFAULT 0 NOT NULL,
	"telemetry_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "assets_asset_tag_unique" UNIQUE("asset_tag")
);
--> statement-breakpoint
CREATE TABLE "cmms_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"setting_key" text NOT NULL,
	"setting_value" json NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "cmms_settings_setting_key_unique" UNIQUE("setting_key")
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"company" text NOT NULL,
	"email" text NOT NULL,
	"phone" text NOT NULL,
	"address" text NOT NULL,
	"credit_limit" numeric DEFAULT '10000' NOT NULL,
	"current_balance" numeric DEFAULT '0' NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"sku" text NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"stock_quantity" integer DEFAULT 0 NOT NULL,
	"unit" text DEFAULT 'sheets' NOT NULL,
	"unit_cost" numeric DEFAULT '0.00' NOT NULL,
	"reorder_level" integer DEFAULT 10 NOT NULL,
	"location" text DEFAULT 'Rack 3-B' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_items_sku_unique" UNIQUE("sku")
);
--> statement-breakpoint
CREATE TABLE "machines" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"category" text NOT NULL,
	"status" text DEFAULT 'Active' NOT NULL,
	"hourly_cost" numeric DEFAULT '65.00' NOT NULL,
	"location" text DEFAULT 'Bay A - North Woodshop' NOT NULL,
	"maintenance_due" timestamp,
	"assigned_operator_id" integer,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "machines_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "maintenance_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"asset_id" integer NOT NULL,
	"event_type" text DEFAULT 'Inspection' NOT NULL,
	"description" text NOT NULL,
	"runtime_at_event" integer DEFAULT 0 NOT NULL,
	"downtime_minutes" integer DEFAULT 0 NOT NULL,
	"parts_cost" numeric DEFAULT '0.00' NOT NULL,
	"labor_cost" numeric DEFAULT '0.00' NOT NULL,
	"performed_by_id" integer,
	"reset_service" boolean DEFAULT false NOT NULL,
	"checklist_json" json,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operation_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"default_steps_json" json NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_materials" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" integer NOT NULL,
	"item_id" integer NOT NULL,
	"quantity_used" integer DEFAULT 1 NOT NULL,
	"cost_per_unit" numeric DEFAULT '0.00' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_operations" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" integer NOT NULL,
	"machine_id" integer,
	"step_order" integer NOT NULL,
	"operation_name" text NOT NULL,
	"estimated_minutes" integer DEFAULT 45 NOT NULL,
	"actual_minutes" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'Pending' NOT NULL,
	"operator_id" integer,
	"start_time" timestamp,
	"end_time" timestamp,
	"scheduled_start" timestamp,
	"scheduled_end" timestamp,
	"quality_notes" text,
	"reject_reason" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_number" text NOT NULL,
	"customer_id" integer NOT NULL,
	"title" text NOT NULL,
	"project_type" text NOT NULL,
	"priority" text DEFAULT 'Normal' NOT NULL,
	"status" text DEFAULT 'In Production' NOT NULL,
	"total_value" numeric DEFAULT '0.00' NOT NULL,
	"due_date" timestamp NOT NULL,
	"progress_percent" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "orders_order_number_unique" UNIQUE("order_number")
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"generated_by" integer,
	"date_from" timestamp NOT NULL,
	"date_to" timestamp NOT NULL,
	"filters_json" json,
	"data_json" json NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"role" text NOT NULL,
	"avatar_color" text DEFAULT 'bg-amber-600' NOT NULL,
	"pin" text DEFAULT '1234' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"phone" text,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_machine_id_machines_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "machines" ADD CONSTRAINT "machines_assigned_operator_id_users_id_fk" FOREIGN KEY ("assigned_operator_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_logs" ADD CONSTRAINT "maintenance_logs_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_logs" ADD CONSTRAINT "maintenance_logs_performed_by_id_users_id_fk" FOREIGN KEY ("performed_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_materials" ADD CONSTRAINT "order_materials_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_materials" ADD CONSTRAINT "order_materials_item_id_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_operations" ADD CONSTRAINT "order_operations_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_operations" ADD CONSTRAINT "order_operations_machine_id_machines_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_operations" ADD CONSTRAINT "order_operations_operator_id_users_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_generated_by_users_id_fk" FOREIGN KEY ("generated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;