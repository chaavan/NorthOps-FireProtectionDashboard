CREATE TABLE "estimate_global_overrides" (
    "id" TEXT NOT NULL,
    "template_key" TEXT NOT NULL,
    "cell" TEXT NOT NULL,
    "value" DECIMAL(14,4) NOT NULL,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "estimate_global_overrides_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "estimate_global_overrides_template_cell_key" ON "estimate_global_overrides"("template_key", "cell");
CREATE INDEX "estimate_global_overrides_template_key_idx" ON "estimate_global_overrides"("template_key");
