-- CreateTable
CREATE TABLE "part_info_changes" (
    "id" TEXT NOT NULL,
    "part_id" TEXT NOT NULL,
    "actor_user_id" TEXT,
    "context_type" TEXT NOT NULL,
    "context_id" TEXT,
    "changes" JSONB NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "part_info_changes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "part_info_changes_part_id_created_at_idx" ON "part_info_changes"("part_id", "created_at" DESC);

CREATE INDEX "part_info_changes_context_type_context_id_idx" ON "part_info_changes"("context_type", "context_id");

CREATE INDEX "part_info_changes_created_at_idx" ON "part_info_changes"("created_at");

ALTER TABLE "part_info_changes" ADD CONSTRAINT "part_info_changes_part_id_fkey" FOREIGN KEY ("part_id") REFERENCES "parts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "part_info_changes" ADD CONSTRAINT "part_info_changes_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
