-- IT-SYSTEM baseline (PostgreSQL) — โครงสร้างเดียวกับ Laravel migrations เดิม
-- pg_trgm: index ค้นหาบางส่วนของคำ (ชื่อ/ยี่ห้อ/รุ่นสินทรัพย์) แทน FULLTEXT ของ MariaDB
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "app_settings" (
    "key" VARCHAR(100) NOT NULL,
    "value" JSONB,
    "updated_by" BIGINT,
    "created_at" TIMESTAMP(0),
    "updated_at" TIMESTAMP(0),

    CONSTRAINT "app_settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "asset_movements" (
    "id" BIGSERIAL NOT NULL,
    "asset_id" BIGINT NOT NULL,
    "type" VARCHAR(20) NOT NULL,
    "from_location_id" BIGINT,
    "to_location_id" BIGINT,
    "from_custodian_id" BIGINT,
    "to_custodian_id" BIGINT,
    "moved_at" TIMESTAMP(0) NOT NULL,
    "reason" TEXT,
    "performed_by" BIGINT,
    "created_at" TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assets" (
    "id" BIGSERIAL NOT NULL,
    "uuid" UUID NOT NULL,
    "asset_tag" VARCHAR(50) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "category" VARCHAR(50) NOT NULL,
    "brand" VARCHAR(100),
    "model" VARCHAR(100),
    "serial_number" VARCHAR(100),
    "status" VARCHAR(20) NOT NULL DEFAULT 'active',
    "location_id" BIGINT,
    "custodian_id" BIGINT,
    "purchase_date" DATE,
    "purchase_cost" DECIMAL(15,2),
    "warranty_expires_at" DATE,
    "notes" TEXT,
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "created_at" TIMESTAMP(0),
    "updated_at" TIMESTAMP(0),
    "deleted_at" TIMESTAMP(0),

    CONSTRAINT "assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branches" (
    "id" BIGSERIAL NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "sort_order" SMALLINT NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(0),
    "updated_at" TIMESTAMP(0),
    "deleted_at" TIMESTAMP(0),

    CONSTRAINT "branches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cache" (
    "key" VARCHAR(255) NOT NULL,
    "value" TEXT NOT NULL,
    "expiration" BIGINT NOT NULL,

    CONSTRAINT "cache_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "cache_locks" (
    "key" VARCHAR(255) NOT NULL,
    "owner" VARCHAR(255) NOT NULL,
    "expiration" BIGINT NOT NULL,

    CONSTRAINT "cache_locks_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "contracts" (
    "id" BIGSERIAL NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "vendor_name" VARCHAR(255) NOT NULL,
    "contract_no" VARCHAR(100),
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "amount" DECIMAL(15,2),
    "contact_name" VARCHAR(255),
    "contact_email" VARCHAR(255),
    "contact_phone" VARCHAR(50),
    "notify_days_before" SMALLINT,
    "notify_enabled" BOOLEAN NOT NULL DEFAULT true,
    "notified_for_end_date" DATE,
    "notified_at" TIMESTAMP(0),
    "notes" TEXT,
    "branch_id" BIGINT,
    "created_by" BIGINT,
    "created_at" TIMESTAMP(0),
    "updated_at" TIMESTAMP(0),
    "deleted_at" TIMESTAMP(0),

    CONSTRAINT "contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credential_access_logs" (
    "id" BIGSERIAL NOT NULL,
    "credential_id" BIGINT NOT NULL,
    "user_id" BIGINT,
    "action" VARCHAR(20) NOT NULL,
    "ip" VARCHAR(45),
    "created_at" TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credential_access_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credentials" (
    "id" BIGSERIAL NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "category" VARCHAR(30) NOT NULL DEFAULT 'system',
    "url" VARCHAR(500),
    "username" VARCHAR(255),
    "password" TEXT,
    "secret_notes" TEXT,
    "notes" TEXT,
    "branch_id" BIGINT,
    "owner_id" BIGINT,
    "expires_at" DATE,
    "notified_for_expires_at" DATE,
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "password_changed_at" TIMESTAMP(0),
    "created_at" TIMESTAMP(0),
    "updated_at" TIMESTAMP(0),
    "deleted_at" TIMESTAMP(0),

    CONSTRAINT "credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "failed_jobs" (
    "id" BIGSERIAL NOT NULL,
    "uuid" VARCHAR(255) NOT NULL,
    "connection" VARCHAR(255) NOT NULL,
    "queue" VARCHAR(255) NOT NULL,
    "payload" TEXT NOT NULL,
    "exception" TEXT NOT NULL,
    "failed_at" TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "failed_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "it_ticket_attachments" (
    "id" BIGSERIAL NOT NULL,
    "it_ticket_id" BIGINT NOT NULL,
    "kind" VARCHAR(20) NOT NULL,
    "path" VARCHAR(255) NOT NULL,
    "original_name" VARCHAR(255),
    "mime" VARCHAR(100),
    "size" INTEGER NOT NULL DEFAULT 0,
    "uploaded_by" BIGINT,
    "created_at" TIMESTAMP(0),
    "updated_at" TIMESTAMP(0),

    CONSTRAINT "it_ticket_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "it_ticket_events" (
    "id" BIGSERIAL NOT NULL,
    "it_ticket_id" BIGINT NOT NULL,
    "user_id" BIGINT,
    "action" VARCHAR(30) NOT NULL,
    "comment" TEXT,
    "created_at" TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "it_ticket_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "it_ticket_parts" (
    "id" BIGSERIAL NOT NULL,
    "it_ticket_id" BIGINT NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "quantity" SMALLINT NOT NULL DEFAULT 1,
    "photo_path" VARCHAR(255),
    "created_at" TIMESTAMP(0),
    "updated_at" TIMESTAMP(0),

    CONSTRAINT "it_ticket_parts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "it_tickets" (
    "id" BIGSERIAL NOT NULL,
    "uuid" UUID NOT NULL,
    "ticket_no" VARCHAR(30) NOT NULL,
    "type" VARCHAR(20) NOT NULL,
    "type_other" VARCHAR(255),
    "status" VARCHAR(30) NOT NULL DEFAULT 'pending_supervisor',
    "requester_id" BIGINT NOT NULL,
    "branch_id" BIGINT,
    "department" VARCHAR(100),
    "division" VARCHAR(100),
    "details" TEXT NOT NULL,
    "due_date" DATE,
    "requester_signature" VARCHAR(255),
    "requested_at" TIMESTAMP(0) NOT NULL,
    "person_name_th" VARCHAR(255),
    "person_name_en" VARCHAR(255),
    "device_name" VARCHAR(255),
    "asset_tag" VARCHAR(50),
    "asset_id" BIGINT,
    "symptom" TEXT,
    "approver_id" BIGINT,
    "approved_at" TIMESTAMP(0),
    "assignee_id" BIGINT,
    "accepted_at" TIMESTAMP(0),
    "result" VARCHAR(20),
    "completed_on" DATE,
    "cannot_reason" TEXT,
    "repair_method" VARCHAR(20),
    "external_vendor" VARCHAR(255),
    "warranty" VARCHAR(20),
    "repair_details" TEXT,
    "staff_signature" VARCHAR(255),
    "resulted_at" TIMESTAMP(0),
    "it_head_id" BIGINT,
    "it_head_signature" VARCHAR(255),
    "closed_at" TIMESTAMP(0),
    "created_at" TIMESTAMP(0),
    "updated_at" TIMESTAMP(0),

    CONSTRAINT "it_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_batches" (
    "id" VARCHAR(255) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "total_jobs" INTEGER NOT NULL,
    "pending_jobs" INTEGER NOT NULL,
    "failed_jobs" INTEGER NOT NULL,
    "failed_job_ids" TEXT NOT NULL,
    "options" TEXT,
    "cancelled_at" INTEGER,
    "created_at" INTEGER NOT NULL,
    "finished_at" INTEGER,

    CONSTRAINT "job_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jobs" (
    "id" BIGSERIAL NOT NULL,
    "queue" VARCHAR(255) NOT NULL,
    "payload" TEXT NOT NULL,
    "attempts" SMALLINT NOT NULL,
    "reserved_at" INTEGER,
    "available_at" INTEGER NOT NULL,
    "created_at" INTEGER NOT NULL,

    CONSTRAINT "jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "locations" (
    "id" BIGSERIAL NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "type" VARCHAR(20) NOT NULL DEFAULT 'room',
    "parent_id" BIGINT,
    "address" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(0),
    "updated_at" TIMESTAMP(0),
    "deleted_at" TIMESTAMP(0),

    CONSTRAINT "locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "migrations" (
    "id" SERIAL NOT NULL,
    "migration" VARCHAR(255) NOT NULL,
    "batch" INTEGER NOT NULL,

    CONSTRAINT "migrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "type" VARCHAR(255) NOT NULL,
    "notifiable_type" VARCHAR(255) NOT NULL,
    "notifiable_id" BIGINT NOT NULL,
    "data" TEXT NOT NULL,
    "read_at" TIMESTAMP(0),
    "created_at" TIMESTAMP(0),
    "updated_at" TIMESTAMP(0),

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "email" VARCHAR(255) NOT NULL,
    "token" VARCHAR(255) NOT NULL,
    "created_at" TIMESTAMP(0),

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("email")
);

-- CreateTable
CREATE TABLE "personal_access_tokens" (
    "id" BIGSERIAL NOT NULL,
    "tokenable_type" VARCHAR(255) NOT NULL,
    "tokenable_id" BIGINT NOT NULL,
    "name" TEXT NOT NULL,
    "token" VARCHAR(64) NOT NULL,
    "abilities" TEXT,
    "last_used_at" TIMESTAMP(0),
    "expires_at" TIMESTAMP(0),
    "created_at" TIMESTAMP(0),
    "updated_at" TIMESTAMP(0),

    CONSTRAINT "personal_access_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" VARCHAR(255) NOT NULL,
    "user_id" BIGINT,
    "ip_address" VARCHAR(45),
    "user_agent" TEXT,
    "payload" TEXT NOT NULL,
    "last_activity" INTEGER NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" BIGSERIAL NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "role" VARCHAR(20) NOT NULL DEFAULT 'viewer',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "branch_id" BIGINT,
    "department" VARCHAR(100),
    "division" VARCHAR(100),
    "supervisor_id" BIGINT,
    "is_it_staff" BOOLEAN NOT NULL DEFAULT false,
    "is_it_head" BOOLEAN NOT NULL DEFAULT false,
    "email_verified_at" TIMESTAMP(0),
    "password" VARCHAR(255) NOT NULL,
    "remember_token" VARCHAR(100),
    "created_at" TIMESTAMP(0),
    "updated_at" TIMESTAMP(0),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "app_settings_updated_by_index" ON "app_settings"("updated_by");

-- CreateIndex
CREATE INDEX "asset_movements_asset_id_moved_at_index" ON "asset_movements"("asset_id", "moved_at");

-- CreateIndex
CREATE INDEX "asset_movements_from_custodian_id_index" ON "asset_movements"("from_custodian_id");

-- CreateIndex
CREATE INDEX "asset_movements_from_location_id_index" ON "asset_movements"("from_location_id");

-- CreateIndex
CREATE INDEX "asset_movements_performed_by_index" ON "asset_movements"("performed_by");

-- CreateIndex
CREATE INDEX "asset_movements_to_custodian_id_moved_at_index" ON "asset_movements"("to_custodian_id", "moved_at");

-- CreateIndex
CREATE INDEX "asset_movements_to_location_id_moved_at_index" ON "asset_movements"("to_location_id", "moved_at");

-- CreateIndex
CREATE UNIQUE INDEX "assets_uuid_unique" ON "assets"("uuid");

-- CreateIndex
CREATE UNIQUE INDEX "assets_asset_tag_unique" ON "assets"("asset_tag");

-- CreateIndex
CREATE INDEX "assets_category_status_index" ON "assets"("category", "status");

-- CreateIndex
CREATE INDEX "assets_created_by_index" ON "assets"("created_by");

-- CreateIndex
CREATE INDEX "assets_custodian_id_index" ON "assets"("custodian_id");

-- CreateIndex
CREATE INDEX "assets_deleted_at_created_at_index" ON "assets"("deleted_at", "created_at");

-- CreateIndex
CREATE INDEX "assets_location_id_index" ON "assets"("location_id");

-- CreateIndex
CREATE INDEX "assets_serial_number_index" ON "assets"("serial_number");

-- CreateIndex
CREATE INDEX "assets_status_location_id_index" ON "assets"("status", "location_id");

-- CreateIndex
CREATE INDEX "assets_updated_by_index" ON "assets"("updated_by");

-- CreateIndex
CREATE INDEX "assets_name_trgm_index" ON "assets" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "assets_brand_trgm_index" ON "assets" USING GIN ("brand" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "assets_model_trgm_index" ON "assets" USING GIN ("model" gin_trgm_ops);

-- CreateIndex
CREATE UNIQUE INDEX "branches_code_unique" ON "branches"("code");

-- CreateIndex
CREATE INDEX "branches_is_active_sort_order_index" ON "branches"("is_active", "sort_order");

-- CreateIndex
CREATE INDEX "cache_expiration_index" ON "cache"("expiration");

-- CreateIndex
CREATE INDEX "cache_locks_expiration_index" ON "cache_locks"("expiration");

-- CreateIndex
CREATE INDEX "contracts_branch_id_index" ON "contracts"("branch_id");

-- CreateIndex
CREATE INDEX "contracts_created_by_index" ON "contracts"("created_by");

-- CreateIndex
CREATE INDEX "contracts_end_date_notify_enabled_index" ON "contracts"("end_date", "notify_enabled");

-- CreateIndex
CREATE INDEX "credential_access_logs_credential_id_created_at_index" ON "credential_access_logs"("credential_id", "created_at");

-- CreateIndex
CREATE INDEX "credential_access_logs_user_id_index" ON "credential_access_logs"("user_id");

-- CreateIndex
CREATE INDEX "credentials_branch_id_index" ON "credentials"("branch_id");

-- CreateIndex
CREATE INDEX "credentials_category_title_index" ON "credentials"("category", "title");

-- CreateIndex
CREATE INDEX "credentials_created_by_index" ON "credentials"("created_by");

-- CreateIndex
CREATE INDEX "credentials_owner_id_index" ON "credentials"("owner_id");

-- CreateIndex
CREATE INDEX "credentials_updated_by_index" ON "credentials"("updated_by");

-- CreateIndex
CREATE UNIQUE INDEX "failed_jobs_uuid_unique" ON "failed_jobs"("uuid");

-- CreateIndex
CREATE INDEX "failed_jobs_connection_queue_failed_at_index" ON "failed_jobs"("connection", "queue", "failed_at");

-- CreateIndex
CREATE INDEX "it_ticket_attachments_it_ticket_id_kind_index" ON "it_ticket_attachments"("it_ticket_id", "kind");

-- CreateIndex
CREATE INDEX "it_ticket_attachments_uploaded_by_index" ON "it_ticket_attachments"("uploaded_by");

-- CreateIndex
CREATE INDEX "it_ticket_events_it_ticket_id_created_at_index" ON "it_ticket_events"("it_ticket_id", "created_at");

-- CreateIndex
CREATE INDEX "it_ticket_events_user_id_index" ON "it_ticket_events"("user_id");

-- CreateIndex
CREATE INDEX "it_ticket_parts_it_ticket_id_index" ON "it_ticket_parts"("it_ticket_id");

-- CreateIndex
CREATE UNIQUE INDEX "it_tickets_uuid_unique" ON "it_tickets"("uuid");

-- CreateIndex
CREATE UNIQUE INDEX "it_tickets_ticket_no_unique" ON "it_tickets"("ticket_no");

-- CreateIndex
CREATE INDEX "it_tickets_approver_id_status_index" ON "it_tickets"("approver_id", "status");

-- CreateIndex
CREATE INDEX "it_tickets_asset_id_index" ON "it_tickets"("asset_id");

-- CreateIndex
CREATE INDEX "it_tickets_assignee_id_status_index" ON "it_tickets"("assignee_id", "status");

-- CreateIndex
CREATE INDEX "it_tickets_branch_id_index" ON "it_tickets"("branch_id");

-- CreateIndex
CREATE INDEX "it_tickets_it_head_id_index" ON "it_tickets"("it_head_id");

-- CreateIndex
CREATE INDEX "it_tickets_requester_id_created_at_index" ON "it_tickets"("requester_id", "created_at");

-- CreateIndex
CREATE INDEX "it_tickets_status_created_at_index" ON "it_tickets"("status", "created_at");

-- CreateIndex
CREATE INDEX "jobs_queue_index" ON "jobs"("queue");

-- CreateIndex
CREATE UNIQUE INDEX "locations_code_unique" ON "locations"("code");

-- CreateIndex
CREATE INDEX "locations_is_active_name_index" ON "locations"("is_active", "name");

-- CreateIndex
CREATE INDEX "locations_parent_id_index" ON "locations"("parent_id");

-- CreateIndex
CREATE INDEX "notifications_notifiable_type_notifiable_id_index" ON "notifications"("notifiable_type", "notifiable_id");

-- CreateIndex
CREATE UNIQUE INDEX "personal_access_tokens_token_unique" ON "personal_access_tokens"("token");

-- CreateIndex
CREATE INDEX "personal_access_tokens_expires_at_index" ON "personal_access_tokens"("expires_at");

-- CreateIndex
CREATE INDEX "personal_access_tokens_tokenable_type_tokenable_id_index" ON "personal_access_tokens"("tokenable_type", "tokenable_id");

-- CreateIndex
CREATE INDEX "sessions_last_activity_index" ON "sessions"("last_activity");

-- CreateIndex
CREATE INDEX "sessions_user_id_index" ON "sessions"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_unique" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_branch_id_index" ON "users"("branch_id");

-- CreateIndex
CREATE INDEX "users_role_index" ON "users"("role");

-- CreateIndex
CREATE INDEX "users_supervisor_id_index" ON "users"("supervisor_id");

-- AddForeignKey
ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_updated_by_foreign" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "asset_movements" ADD CONSTRAINT "asset_movements_asset_id_foreign" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "asset_movements" ADD CONSTRAINT "asset_movements_from_custodian_id_foreign" FOREIGN KEY ("from_custodian_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "asset_movements" ADD CONSTRAINT "asset_movements_from_location_id_foreign" FOREIGN KEY ("from_location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "asset_movements" ADD CONSTRAINT "asset_movements_performed_by_foreign" FOREIGN KEY ("performed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "asset_movements" ADD CONSTRAINT "asset_movements_to_custodian_id_foreign" FOREIGN KEY ("to_custodian_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "asset_movements" ADD CONSTRAINT "asset_movements_to_location_id_foreign" FOREIGN KEY ("to_location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_created_by_foreign" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_custodian_id_foreign" FOREIGN KEY ("custodian_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_location_id_foreign" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_updated_by_foreign" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_branch_id_foreign" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_created_by_foreign" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "credential_access_logs" ADD CONSTRAINT "credential_access_logs_credential_id_foreign" FOREIGN KEY ("credential_id") REFERENCES "credentials"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "credential_access_logs" ADD CONSTRAINT "credential_access_logs_user_id_foreign" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_branch_id_foreign" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_created_by_foreign" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_owner_id_foreign" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_updated_by_foreign" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "it_ticket_attachments" ADD CONSTRAINT "it_ticket_attachments_it_ticket_id_foreign" FOREIGN KEY ("it_ticket_id") REFERENCES "it_tickets"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "it_ticket_attachments" ADD CONSTRAINT "it_ticket_attachments_uploaded_by_foreign" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "it_ticket_events" ADD CONSTRAINT "it_ticket_events_it_ticket_id_foreign" FOREIGN KEY ("it_ticket_id") REFERENCES "it_tickets"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "it_ticket_events" ADD CONSTRAINT "it_ticket_events_user_id_foreign" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "it_ticket_parts" ADD CONSTRAINT "it_ticket_parts_it_ticket_id_foreign" FOREIGN KEY ("it_ticket_id") REFERENCES "it_tickets"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "it_tickets" ADD CONSTRAINT "it_tickets_approver_id_foreign" FOREIGN KEY ("approver_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "it_tickets" ADD CONSTRAINT "it_tickets_asset_id_foreign" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "it_tickets" ADD CONSTRAINT "it_tickets_assignee_id_foreign" FOREIGN KEY ("assignee_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "it_tickets" ADD CONSTRAINT "it_tickets_branch_id_foreign" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "it_tickets" ADD CONSTRAINT "it_tickets_it_head_id_foreign" FOREIGN KEY ("it_head_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "it_tickets" ADD CONSTRAINT "it_tickets_requester_id_foreign" FOREIGN KEY ("requester_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "locations" ADD CONSTRAINT "locations_parent_id_foreign" FOREIGN KEY ("parent_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_branch_id_foreign" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_supervisor_id_foreign" FOREIGN KEY ("supervisor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE RESTRICT;
