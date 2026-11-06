CREATE TABLE "booking_attempts" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "booking_attempts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"email" text NOT NULL,
	"attempted_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bookings" (
	"id" text PRIMARY KEY NOT NULL,
	"slot_id" text NOT NULL,
	"patient_name" text NOT NULL,
	"patient_email" text NOT NULL,
	"status" text DEFAULT 'confirmed' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cancelled_at" timestamp with time zone,
	CONSTRAINT "bookings_status_check" CHECK ("bookings"."status" in ('confirmed', 'cancelled')),
	CONSTRAINT "bookings_cancellation_check" CHECK (("bookings"."status" = 'confirmed' and "bookings"."cancelled_at" is null)
        or ("bookings"."status" = 'cancelled' and "bookings"."cancelled_at" is not null)),
	CONSTRAINT "bookings_email_normalized_check" CHECK ("bookings"."patient_email" = lower(btrim("bookings"."patient_email")))
);
--> statement-breakpoint
CREATE TABLE "idempotency_records" (
	"client_scope" text NOT NULL,
	"operation" text NOT NULL,
	"key" text NOT NULL,
	"request_hash" text NOT NULL,
	"response_status" smallint NOT NULL,
	"response_body" jsonb NOT NULL,
	"response_headers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idempotency_records_client_scope_operation_key_pk" PRIMARY KEY("client_scope","operation","key"),
	CONSTRAINT "idempotency_hash_check" CHECK ("idempotency_records"."request_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "idempotency_status_check" CHECK ("idempotency_records"."response_status" between 100 and 599),
	CONSTRAINT "idempotency_headers_check" CHECK (jsonb_typeof("idempotency_records"."response_headers") = 'object')
);
--> statement-breakpoint
CREATE TABLE "slots" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_slot_id_slots_id_fk" FOREIGN KEY ("slot_id") REFERENCES "public"."slots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "booking_attempts_email_time_id_idx" ON "booking_attempts" USING btree ("email","attempted_at","id");--> statement-breakpoint
CREATE INDEX "booking_attempts_time_idx" ON "booking_attempts" USING btree ("attempted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "bookings_one_confirmed_per_slot_idx" ON "bookings" USING btree ("slot_id") WHERE "bookings"."status" = 'confirmed';--> statement-breakpoint
CREATE INDEX "bookings_email_created_id_idx" ON "bookings" USING btree ("patient_email","created_at","id");--> statement-breakpoint
CREATE INDEX "bookings_slot_id_idx" ON "bookings" USING btree ("slot_id");--> statement-breakpoint
CREATE INDEX "slots_start_id_idx" ON "slots" USING btree ("starts_at","id");--> statement-breakpoint
CREATE INDEX "slots_provider_start_id_idx" ON "slots" USING btree ("provider","starts_at","id");