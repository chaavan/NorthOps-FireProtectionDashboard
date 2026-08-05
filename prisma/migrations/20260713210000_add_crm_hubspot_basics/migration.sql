-- CreateTable
CREATE TABLE "crm_activities" (
    "id" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "account_id" TEXT,
    "activity_type" TEXT NOT NULL DEFAULT 'NOTE',
    "subject" TEXT,
    "body" TEXT,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_tasks" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "due_date" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "assignee_email" TEXT,
    "entity_type" TEXT,
    "entity_id" TEXT,
    "account_id" TEXT,
    "created_by" TEXT,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_tags" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#3b82f6',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_entity_tags" (
    "id" TEXT NOT NULL,
    "tag_id" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_entity_tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_attachments" (
    "id" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "account_id" TEXT,
    "r2_key" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "file_name" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "crm_activities_entity_type_entity_id_idx" ON "crm_activities"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "crm_activities_account_id_idx" ON "crm_activities"("account_id");

-- CreateIndex
CREATE INDEX "crm_activities_occurred_at_idx" ON "crm_activities"("occurred_at");

-- CreateIndex
CREATE INDEX "crm_tasks_assignee_email_status_idx" ON "crm_tasks"("assignee_email", "status");

-- CreateIndex
CREATE INDEX "crm_tasks_entity_type_entity_id_idx" ON "crm_tasks"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "crm_tasks_due_date_idx" ON "crm_tasks"("due_date");

-- CreateIndex
CREATE UNIQUE INDEX "crm_tags_name_key" ON "crm_tags"("name");

-- CreateIndex
CREATE INDEX "crm_entity_tags_entity_type_entity_id_idx" ON "crm_entity_tags"("entity_type", "entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "crm_entity_tags_tag_id_entity_type_entity_id_key" ON "crm_entity_tags"("tag_id", "entity_type", "entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "crm_attachments_r2_key_key" ON "crm_attachments"("r2_key");

-- CreateIndex
CREATE INDEX "crm_attachments_entity_type_entity_id_idx" ON "crm_attachments"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "crm_attachments_account_id_idx" ON "crm_attachments"("account_id");

-- CreateIndex
CREATE INDEX "crm_attachments_created_at_idx" ON "crm_attachments"("created_at");

-- AddForeignKey
ALTER TABLE "crm_activities" ADD CONSTRAINT "crm_activities_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "crm_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_tasks" ADD CONSTRAINT "crm_tasks_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "crm_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_entity_tags" ADD CONSTRAINT "crm_entity_tags_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "crm_tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_attachments" ADD CONSTRAINT "crm_attachments_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "crm_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
