-- Header-only (first page) import workflow: full | header_stub
ALTER TABLE "job_imports" ADD COLUMN "import_intent" TEXT NOT NULL DEFAULT 'full';
