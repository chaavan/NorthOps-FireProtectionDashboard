-- Split job-scoped entities by (job_number, list_number) to prevent cross-list data sharing.

ALTER TABLE public.deliveries
  ADD COLUMN IF NOT EXISTS list_number TEXT;

UPDATE public.deliveries
SET list_number = '1'
WHERE list_number IS NULL OR btrim(list_number) = '';

ALTER TABLE public.deliveries
  ALTER COLUMN list_number SET DEFAULT '1',
  ALTER COLUMN list_number SET NOT NULL;

DO $$
DECLARE
  constraint_name TEXT;
BEGIN
  FOR constraint_name IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'public'
      AND rel.relname = 'deliveries'
      AND con.contype = 'u'
      AND array_length(con.conkey, 1) = 1
      AND (
        SELECT att.attname
        FROM pg_attribute att
        WHERE att.attrelid = rel.oid
          AND att.attnum = con.conkey[1]
      ) = 'job_number'
  LOOP
    EXECUTE format('ALTER TABLE public.deliveries DROP CONSTRAINT %I', constraint_name);
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS deliveries_job_number_list_number_key
  ON public.deliveries (job_number, list_number);

CREATE INDEX IF NOT EXISTS deliveries_job_number_list_number_idx
  ON public.deliveries (job_number, list_number);


ALTER TABLE public.job_access
  ADD COLUMN IF NOT EXISTS list_number TEXT;

UPDATE public.job_access
SET list_number = '1'
WHERE list_number IS NULL OR btrim(list_number) = '';

ALTER TABLE public.job_access
  ALTER COLUMN list_number SET DEFAULT '1',
  ALTER COLUMN list_number SET NOT NULL;

DO $$
DECLARE
  constraint_name TEXT;
BEGIN
  FOR constraint_name IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'public'
      AND rel.relname = 'job_access'
      AND con.contype = 'u'
      AND (
        SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
        FROM unnest(con.conkey) WITH ORDINALITY AS ord(attnum, ordinality)
        JOIN pg_attribute att
          ON att.attrelid = rel.oid
         AND att.attnum = ord.attnum
      ) = ARRAY['job_number', 'user_email']::text[]
  LOOP
    EXECUTE format('ALTER TABLE public.job_access DROP CONSTRAINT %I', constraint_name);
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS job_access_job_number_list_number_user_email_key
  ON public.job_access (job_number, list_number, user_email);

CREATE INDEX IF NOT EXISTS job_access_job_number_list_number_idx
  ON public.job_access (job_number, list_number);


ALTER TABLE public.job_notes
  ADD COLUMN IF NOT EXISTS list_number TEXT;

UPDATE public.job_notes
SET list_number = '1'
WHERE list_number IS NULL OR btrim(list_number) = '';

ALTER TABLE public.job_notes
  ALTER COLUMN list_number SET DEFAULT '1',
  ALTER COLUMN list_number SET NOT NULL;

CREATE INDEX IF NOT EXISTS job_notes_job_number_list_number_idx
  ON public.job_notes (job_number, list_number);


ALTER TABLE public.job_note_attachments
  ADD COLUMN IF NOT EXISTS list_number TEXT;

UPDATE public.job_note_attachments AS attachment
SET list_number = note.list_number
FROM public.job_notes AS note
WHERE note.id = attachment.note_id
  AND (attachment.list_number IS NULL OR btrim(attachment.list_number) = '');

UPDATE public.job_note_attachments
SET list_number = '1'
WHERE list_number IS NULL OR btrim(list_number) = '';

ALTER TABLE public.job_note_attachments
  ALTER COLUMN list_number SET DEFAULT '1',
  ALTER COLUMN list_number SET NOT NULL;

CREATE INDEX IF NOT EXISTS job_note_attachments_job_number_list_number_idx
  ON public.job_note_attachments (job_number, list_number);
