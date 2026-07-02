-- CreateTable
CREATE TABLE IF NOT EXISTS "password_reset_requests" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "hashed_password" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "password_reset_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "password_reset_requests_email_idx" ON "password_reset_requests"("email");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "password_reset_requests_status_idx" ON "password_reset_requests"("status");
