CREATE TABLE "flows" (
	"space_id" text PRIMARY KEY NOT NULL,
	"flow" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "holds" (
	"space_id" text NOT NULL,
	"sender" text NOT NULL,
	"hold" boolean NOT NULL,
	CONSTRAINT "holds_space_id_sender_pk" PRIMARY KEY("space_id","sender")
);
--> statement-breakpoint
CREATE TABLE "retries" (
	"space_id" text NOT NULL,
	"delivery_id" text NOT NULL,
	"doc_id" text NOT NULL,
	"due" text NOT NULL,
	CONSTRAINT "retries_space_id_delivery_id_pk" PRIMARY KEY("space_id","delivery_id")
);
--> statement-breakpoint
-- Example rows pointed at examples/<doc_id>.json; their content moves into these columns. scripts/migrate-storage.ts
-- writes them back from those files, so the rows are cleared rather than left without content.
DELETE FROM "approved_examples";--> statement-breakpoint
ALTER TABLE "approved_examples" ADD COLUMN "answer" jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "approved_examples" ADD COLUMN "model" jsonb NOT NULL;