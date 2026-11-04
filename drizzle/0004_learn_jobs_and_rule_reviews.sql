CREATE TABLE "learn_jobs" (
	"space_id" text NOT NULL,
	"doc_id" text NOT NULL,
	"started_at" text,
	"tries" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "learn_jobs_space_id_doc_id_pk" PRIMARY KEY("space_id","doc_id")
);
--> statement-breakpoint
CREATE TABLE "rule_reviews" (
	"space_id" text NOT NULL,
	"doc_id" text NOT NULL,
	"key" text NOT NULL,
	"printed" text,
	"read" text,
	"fixed" text,
	CONSTRAINT "rule_reviews_space_id_doc_id_key_pk" PRIMARY KEY("space_id","doc_id","key")
);
