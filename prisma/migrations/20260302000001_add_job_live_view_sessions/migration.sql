-- Create table to track live viewers on a specific job + list context.
CREATE TABLE "job_live_view_sessions" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "job_number" TEXT NOT NULL,
    "list_number" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "user_email" TEXT NOT NULL,
    "user_name" TEXT,
    "active_tab" TEXT NOT NULL,
    "last_seen_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "job_live_view_sessions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "job_live_view_sessions_session_id_key"
    ON "job_live_view_sessions"("session_id");

CREATE INDEX "job_live_view_sessions_job_number_list_number_idx"
    ON "job_live_view_sessions"("job_number", "list_number");

CREATE INDEX "job_live_view_sessions_job_number_list_number_last_seen_at_idx"
    ON "job_live_view_sessions"("job_number", "list_number", "last_seen_at");

CREATE INDEX "job_live_view_sessions_user_id_idx"
    ON "job_live_view_sessions"("user_id");
