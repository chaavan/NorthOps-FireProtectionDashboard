-- Drop legacy estimate workbook tables (feature removed from app; reimplementation TBD).

DROP TABLE IF EXISTS "estimate_revisions";
DROP TABLE IF EXISTS "estimates";

DROP TYPE IF EXISTS "EstimateStatus";
