-- Drop legacy unique index on deliveries(job_number).
-- We now enforce uniqueness on (job_number, list_number) instead (see 20260303000000_split_job_scoped_entities_by_list_number).

DROP INDEX IF EXISTS "deliveries_job_number_key";

