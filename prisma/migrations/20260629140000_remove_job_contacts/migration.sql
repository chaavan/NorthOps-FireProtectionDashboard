-- job_notifications.contact_id references job_contacts; drop that dependency first.
ALTER TABLE "job_notifications" DROP CONSTRAINT IF EXISTS "job_notifications_contact_id_fkey";
DROP INDEX IF EXISTS "job_notifications_contact_id_idx";
ALTER TABLE "job_notifications" DROP COLUMN IF EXISTS "contact_id";

-- Drop job-specific and global contact tables; contacts were unused in the dashboard.
DROP TABLE IF EXISTS "job_contacts";
DROP TABLE IF EXISTS "contacts";

DELETE FROM "role_permission_templates" WHERE "permission_key" = 'job.contacts.manage';
DELETE FROM "permission_overrides" WHERE "permission_key" = 'job.contacts.manage';
DELETE FROM "job_permission_overrides" WHERE "permission_key" = 'job.contacts.manage';
