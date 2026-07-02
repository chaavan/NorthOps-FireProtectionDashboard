CREATE TABLE IF NOT EXISTS "packing_slips" (
  "id"           text PRIMARY KEY,
  "job_number"   text NOT NULL,
  "list_number"  text NOT NULL DEFAULT '1',
  "file_name"    text NOT NULL,
  "storage_key"  text NOT NULL,
  "content_type" text,
  "size"         integer,
  "uploaded_by"  text NOT NULL,
  "uploaded_at"  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "packing_slips_job_number_list_number_idx"
  ON "packing_slips"("job_number", "list_number");

