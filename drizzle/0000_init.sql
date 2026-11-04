CREATE TABLE "approved_examples" (
	"n" integer GENERATED ALWAYS AS IDENTITY (sequence name "approved_examples_n_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"space_id" text NOT NULL,
	"doc_id" text NOT NULL,
	"sender" text NOT NULL,
	"cls" text NOT NULL,
	"key" text NOT NULL,
	CONSTRAINT "approved_examples_space_id_doc_id_pk" PRIMARY KEY("space_id","doc_id")
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"space_id" text NOT NULL,
	"id" text NOT NULL,
	"name" text NOT NULL,
	"sender" text,
	"cls" text,
	"status" text NOT NULL,
	"created_at" text NOT NULL,
	"flagged" integer,
	"reopened" boolean DEFAULT false NOT NULL,
	"approved_at" text,
	"prompt_version_id" text,
	"template_hash" text,
	"model" text,
	CONSTRAINT "documents_space_id_id_pk" PRIMARY KEY("space_id","id")
);
--> statement-breakpoint
CREATE TABLE "model_calls" (
	"call_id" text PRIMARY KEY NOT NULL,
	"space_id" text NOT NULL,
	"doc_id" text,
	"step_id" text NOT NULL,
	"attempt_purpose" text NOT NULL,
	"attempt" integer NOT NULL,
	"model" text NOT NULL,
	"usage" jsonb,
	"cost_usd" double precision,
	"ms" integer NOT NULL,
	"request_id" text,
	"prompt_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prompt_versions" (
	"space_id" text NOT NULL,
	"id" text NOT NULL,
	"level" text NOT NULL,
	"key" text NOT NULL,
	"version" integer NOT NULL,
	"parent" text,
	"status" text NOT NULL,
	"columns" jsonb NOT NULL,
	"notes" jsonb NOT NULL,
	"examples" jsonb NOT NULL,
	"always_review" jsonb NOT NULL,
	"change" text NOT NULL,
	CONSTRAINT "prompt_versions_space_id_id_pk" PRIMARY KEY("space_id","id")
);
--> statement-breakpoint
CREATE TABLE "usage" (
	"day" text PRIMARY KEY NOT NULL,
	"n" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "one_call_per_attempt" ON "model_calls" USING btree ("step_id","attempt_purpose","attempt");--> statement-breakpoint
CREATE UNIQUE INDEX "one_active_version" ON "prompt_versions" USING btree ("space_id","level","key") WHERE status = 'active';