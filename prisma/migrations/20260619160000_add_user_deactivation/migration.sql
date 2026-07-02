ALTER TABLE "User" ADD COLUMN "deactivated_at" TIMESTAMP(3);

CREATE INDEX "User_deactivated_at_idx" ON "User"("deactivated_at");
