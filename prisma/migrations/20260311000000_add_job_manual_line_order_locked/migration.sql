ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS manual_line_order_locked BOOLEAN NOT NULL DEFAULT false;
