-- CreateTable
CREATE TABLE "part_cost_changes" (
    "id" TEXT NOT NULL,
    "part_id" TEXT NOT NULL,
    "actor_user_id" TEXT,
    "cost_before" DECIMAL(10,2),
    "cost_after" DECIMAL(10,2) NOT NULL,
    "context_type" TEXT NOT NULL,
    "context_id" TEXT,
    "note" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "part_cost_changes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "part_cost_changes_part_id_created_at_idx" ON "part_cost_changes"("part_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "part_cost_changes_context_type_context_id_idx" ON "part_cost_changes"("context_type", "context_id");

-- CreateIndex
CREATE INDEX "part_cost_changes_created_at_idx" ON "part_cost_changes"("created_at");

-- AddForeignKey
ALTER TABLE "part_cost_changes" ADD CONSTRAINT "part_cost_changes_part_id_fkey" FOREIGN KEY ("part_id") REFERENCES "parts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "part_cost_changes" ADD CONSTRAINT "part_cost_changes_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
