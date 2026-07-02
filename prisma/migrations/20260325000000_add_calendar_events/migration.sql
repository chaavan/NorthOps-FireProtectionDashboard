CREATE TABLE IF NOT EXISTS "calendar_events" (
  "id"          text PRIMARY KEY,
  "title"       text NOT NULL,
  "date"        timestamptz NOT NULL,
  "notes"       text,
  "created_by"  text,
  "created_at"  timestamptz NOT NULL DEFAULT now(),
  "updated_at"  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "calendar_events_date_idx"
  ON "calendar_events"("date");

