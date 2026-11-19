-- IT-SYSTEM บน PostgreSQL 18 — โครงสร้างตั้งต้น (เทียบเท่า migration ของ MySQL ทั้งหมดถึง 20261215090000_fixed_assets_sync)
-- สร้างจาก prisma/postgres/schema.prisma (prisma migrate diff --from-empty) + ส่วนที่ Prisma เขียนเองไม่ได้: citext, CHECK, คอลัมน์ GENERATED

-- ข้อความไม่สนตัวพิมพ์ (เทียบ utf8mb4_0900_as_ci ของ MySQL) — citext เป็น trusted extension เจ้าของฐานสร้างเองได้
CREATE EXTENSION IF NOT EXISTS citext;

-- notifications.subject_ref = รหัสเรื่องจาก data (JSON ข้อความ) — ต้องเป็น IMMUTABLE เพื่อใช้ใน GENERATED STORED
CREATE FUNCTION eam_subject_ref(payload text) RETURNS citext
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE j jsonb;
BEGIN
  BEGIN
    j := payload::jsonb;
  EXCEPTION WHEN others THEN
    RETURN NULL;
  END;
  IF jsonb_typeof(j) <> 'object' THEN
    RETURN NULL;
  END IF;
  RETURN COALESCE(j->>'ticket_id', j->>'leave_id', j->>'vehicle_booking_id', j->>'loan_id', j->>'vpn_id', j->>'zoom_booking_id', j->>'repair_order_id')::citext;
END
$$;

-- CreateTable
CREATE TABLE "app_settings" (
    "key" CITEXT NOT NULL,
    "value" JSONB,
    "updated_by" BIGINT,
    "created_at" TIMESTAMP(0),
    "updated_at" TIMESTAMP(0),

    CONSTRAINT "app_settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "announcements" (
    "id" BIGSERIAL NOT NULL,
    "title" CITEXT NOT NULL,
    "body" CITEXT,
    "level" CITEXT NOT NULL DEFAULT 'info',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "starts_on" DATE,
    "ends_on" DATE,
    "sort_order" SMALLINT NOT NULL DEFAULT 0,
    "repeat_mode" CITEXT NOT NULL DEFAULT 'none',
    "repeat_weekday" SMALLINT,
    "repeat_day" SMALLINT,
    "repeat_month" SMALLINT,
    "created_by" BIGINT,
    "created_at" TIMESTAMP(0),
    "updated_at" TIMESTAMP(0),

    CONSTRAINT "announcements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_routes" (
    "id" BIGSERIAL NOT NULL,
    "name" CITEXT NOT NULL,
    "branch_id" BIGINT,
    "department" CITEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(0),
    "updated_at" TIMESTAMP(0),

    CONSTRAINT "approval_routes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_route_steps" (
    "id" BIGSERIAL NOT NULL,
    "approval_route_id" BIGINT NOT NULL,
    "step_no" SMALLINT NOT NULL,
    "name" CITEXT NOT NULL,
    "created_at" TIMESTAMP(0),
    "updated_at" TIMESTAMP(0),

    CONSTRAINT "approval_route_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_step_approvers" (
    "approval_route_step_id" BIGINT NOT NULL,
    "user_id" BIGINT NOT NULL,

    CONSTRAINT "approval_step_approvers_pkey" PRIMARY KEY ("approval_route_step_id","user_id")
);

-- CreateTable
CREATE TABLE "it_ticket_approval_steps" (
    "id" BIGSERIAL NOT NULL,
    "it_ticket_id" BIGINT NOT NULL,
    "step_no" SMALLINT NOT NULL,
    "name" CITEXT NOT NULL,
    "approver_ids" JSONB NOT NULL,
    "status" CITEXT NOT NULL DEFAULT 'pending',
    "acted_by" BIGINT,
    "acted_at" TIMESTAMP(0),
    "comment" CITEXT,
    "created_at" TIMESTAMP(0),
    "updated_at" TIMESTAMP(0),

    CONSTRAINT "it_ticket_approval_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_licenses" (
    "id" BIGSERIAL NOT NULL,
    "asset_id" BIGINT NOT NULL,
    "billing" CITEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "expires_at" DATE,
    "seats" INTEGER,
    "vendor" CITEXT,
    "license_key" CITEXT,
    "notify_days_before" SMALLINT,
    "notified_for_expires_at" DATE,
    "software_type" CITEXT NOT NULL DEFAULT 'other',
    "cancelled_at" TIMESTAMP(0),
    "cancelled_by" BIGINT,
    "cancel_reason" CITEXT,
    "created_at" TIMESTAMP(0),
    "updated_at" TIMESTAMP(0),

    CONSTRAINT "asset_licenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "licenses" (
    "id" BIGSERIAL NOT NULL,
    "uuid" CITEXT NOT NULL,
    "license_no" CITEXT,
    "name" CITEXT NOT NULL,
    "brand" CITEXT,
    "model" CITEXT,
    "serial_number" CITEXT,
    "status" CITEXT NOT NULL DEFAULT 'active',
    "location_id" BIGINT,
    "branch_id" BIGINT,
    "purchase_date" DATE,
    "purchase_cost" DECIMAL(15,2),
    "notes" CITEXT,
    "software_type" CITEXT NOT NULL DEFAULT 'other',
    "billing" CITEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "expires_at" DATE,
    "seats" INTEGER,
    "vendor" CITEXT,
    "license_key" CITEXT,
    "notify_days_before" SMALLINT,
    "notified_for_expires_at" DATE,
    "cancelled_at" TIMESTAMP(0),
    "cancelled_by" BIGINT,
    "cancel_reason" CITEXT,
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "created_at" TIMESTAMP(0),
    "updated_at" TIMESTAMP(0),
    "deleted_at" TIMESTAMP(0),

    CONSTRAINT "licenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "license_files" (
    "id" BIGSERIAL NOT NULL,
    "license_id" BIGINT NOT NULL,
    "kind" CITEXT NOT NULL DEFAULT 'license',
    "original_name" CITEXT NOT NULL,
    "path" CITEXT NOT NULL,
    "mime" CITEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "uploaded_by" BIGINT,
    "created_at" TIMESTAMP(0),
    "updated_at" TIMESTAMP(0),

    CONSTRAINT "license_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "license_installations" (
    "id" BIGSERIAL NOT NULL,
    "license_asset_id" BIGINT,
    "license_id" BIGINT,
    "device_asset_id" BIGINT,
    "device_name" CITEXT,
    "user_id" BIGINT,
    "branch_id" BIGINT,
    "installed_at" DATE NOT NULL,
    "uninstalled_at" DATE,
    "notes" CITEXT,
    "slot" CITEXT,
    "created_by" BIGINT,
    "created_at" TIMESTAMP(0),
    "updated_at" TIMESTAMP(0),

    CONSTRAINT "license_installations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_files" (
    "id" BIGSERIAL NOT NULL,
    "asset_id" BIGINT NOT NULL,
    "kind" CITEXT NOT NULL DEFAULT 'license',
    "original_name" CITEXT NOT NULL,
    "path" CITEXT NOT NULL,
    "mime" CITEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "uploaded_by" BIGINT,
    "created_at" TIMESTAMP(0),
    "updated_at" TIMESTAMP(0),

    CONSTRAINT "asset_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_movements" (
    "id" BIGSERIAL NOT NULL,
    "asset_id" BIGINT NOT NULL,
    "type" CITEXT NOT NULL,
    "from_location_id" BIGINT,
    "to_location_id" BIGINT,
    "from_custodian_id" BIGINT,
    "to_custodian_id" BIGINT,
    "moved_at" TIMESTAMP(0) NOT NULL,
    "reason" CITEXT,
    "performed_by" BIGINT,
    "from_branch_id" BIGINT,
    "to_branch_id" BIGINT,
    "created_at" TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_user_logs" (
    "id" BIGSERIAL NOT NULL,
    "asset_id" BIGINT NOT NULL,
    "from_user_name" CITEXT,
    "to_user_name" CITEXT,
    "from_department" CITEXT,
    "to_department" CITEXT,
    "source" CITEXT NOT NULL,
    "changed_at" TIMESTAMP(0) NOT NULL,
    "performed_by" BIGINT,
    "created_at" TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_user_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assets" (
    "id" BIGSERIAL NOT NULL,
    "uuid" CITEXT NOT NULL,
    "asset_tag" CITEXT NOT NULL,
    "name" CITEXT NOT NULL,
    "category" CITEXT NOT NULL,
    "brand" CITEXT,
    "model" CITEXT,
    "serial_number" CITEXT,
    "status" CITEXT NOT NULL DEFAULT 'active',
    "is_loanable" BOOLEAN NOT NULL DEFAULT false,
    "is_shared" BOOLEAN NOT NULL DEFAULT false,
    "location_id" BIGINT,
    "custodian_id" BIGINT,
    "purchase_date" DATE,
    "purchase_cost" DECIMAL(15,2),
    "warranty_expires_at" DATE,
    "notes" CITEXT,
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "created_at" TIMESTAMP(0),
    "updated_at" TIMESTAMP(0),
    "deleted_at" TIMESTAMP(0),
    "branch_id" BIGINT,
    "department" CITEXT,
    "user_name" CITEXT,
    "received_date" DATE,
    "start_use_date" DATE,
    "work_group" CITEXT,
    "mac_address" CITEXT,
    "computer_type" CITEXT,
    "ip_address" CITEXT,
    "os" CITEXT,
    "office" CITEXT,
    "email_365" CITEXT,
    "antivirus" CITEXT,
    "notebook_tag" CITEXT,
    "cpu_tag" CITEXT,
    "monitor_tag" CITEXT,
    "other_software" CITEXT,
    "computer_spec" CITEXT,

    CONSTRAINT "assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branches" (
    "id" BIGSERIAL NOT NULL,
    "code" CITEXT NOT NULL,
    "name" CITEXT NOT NULL,
    "sort_order" SMALLINT NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(0),
    "updated_at" TIMESTAMP(0),
    "deleted_at" TIMESTAMP(0),
    "work_group" CITEXT,
    "holiday_calendar_id" BIGINT,

    CONSTRAINT "branches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cache" (
    "key" CITEXT NOT NULL,
    "value" CITEXT NOT NULL,
    "expiration" BIGINT NOT NULL,

    CONSTRAINT "cache_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "cache_locks" (
    "key" CITEXT NOT NULL,
    "owner" CITEXT NOT NULL,
    "expiration" BIGINT NOT NULL,

    CONSTRAINT "cache_locks_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "contract_categories" (
    "id" BIGSERIAL NOT NULL,
    "name" CITEXT NOT NULL,
    "builtin_key" CITEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" SMALLINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(0),
    "updated_at" TIMESTAMP(0),

    CONSTRAINT "contract_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dropdown_options" (
    "id" BIGSERIAL NOT NULL,
    "list" CITEXT NOT NULL,
    "name" CITEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" SMALLINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(0),
    "updated_at" TIMESTAMP(0),

    CONSTRAINT "dropdown_options_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contracts" (
    "id" BIGSERIAL NOT NULL,
    "title" CITEXT NOT NULL,
    "vendor_name" CITEXT NOT NULL,
    "contract_no" CITEXT,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "amount" DECIMAL(15,2),
    "contact_name" CITEXT,
    "contact_email" CITEXT,
    "contact_phone" CITEXT,
    "notify_days_before" SMALLINT,
    "notify_enabled" BOOLEAN NOT NULL DEFAULT true,
    "notified_for_end_date" DATE,
    "notified_at" TIMESTAMP(0),
    "notify_dates" JSONB,
    "notified_for_date" DATE,
    "notes" CITEXT,
    "branch_id" BIGINT,
    "category_id" BIGINT,
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
    "action" CITEXT NOT NULL,
    "ip" CITEXT,
    "created_at" TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credential_access_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credentials" (
    "id" BIGSERIAL NOT NULL,
    "title" CITEXT NOT NULL,
    "category" CITEXT NOT NULL DEFAULT 'system',
    "url" CITEXT,
    "username" CITEXT,
    "password" CITEXT,
    "secret_notes" CITEXT,
    "notes" CITEXT,
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
    "require_reauth" BOOLEAN NOT NULL DEFAULT true,
    "access_mode" CITEXT NOT NULL DEFAULT 'all',

    CONSTRAINT "credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "failed_jobs" (
    "id" BIGSERIAL NOT NULL,
    "uuid" CITEXT NOT NULL,
    "connection" CITEXT NOT NULL,
    "queue" CITEXT NOT NULL,
    "payload" CITEXT NOT NULL,
    "exception" CITEXT NOT NULL,
    "failed_at" TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "failed_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "it_ticket_attachments" (
    "id" BIGSERIAL NOT NULL,
    "it_ticket_id" BIGINT NOT NULL,
    "kind" CITEXT NOT NULL,
    "path" CITEXT NOT NULL,
    "original_name" CITEXT,
    "mime" CITEXT,
    "size" INTEGER NOT NULL DEFAULT 0,
    "uploaded_by" BIGINT,
    "created_at" TIMESTAMP(0),
    "updated_at" TIMESTAMP(0),
    "event_id" BIGINT,

    CONSTRAINT "it_ticket_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "it_ticket_events" (
    "id" BIGSERIAL NOT NULL,
    "it_ticket_id" BIGINT NOT NULL,
    "user_id" BIGINT,
    "action" CITEXT NOT NULL,
    "comment" CITEXT,
    "created_at" TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "repair_order_id" BIGINT,

    CONSTRAINT "it_ticket_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "it_ticket_helpers" (
    "id" BIGSERIAL NOT NULL,
    "it_ticket_id" BIGINT NOT NULL,
    "user_id" BIGINT NOT NULL,
    "added_by" BIGINT,
    "created_at" TIMESTAMP(0),
    "updated_at" TIMESTAMP(0),

    CONSTRAINT "it_ticket_helpers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "it_ticket_parts" (
    "id" BIGSERIAL NOT NULL,
    "it_ticket_id" BIGINT NOT NULL,
    "name" CITEXT NOT NULL,
    "quantity" SMALLINT NOT NULL DEFAULT 1,
    "photo_path" CITEXT,
    "created_at" TIMESTAMP(0),
    "updated_at" TIMESTAMP(0),

    CONSTRAINT "it_ticket_parts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "it_tickets" (
    "id" BIGSERIAL NOT NULL,
    "uuid" CITEXT NOT NULL,
    "ticket_no" CITEXT NOT NULL,
    "type" CITEXT NOT NULL,
    "type_other" CITEXT,
    "status" CITEXT NOT NULL DEFAULT 'pending_supervisor',
    "requester_id" BIGINT NOT NULL,
    "branch_id" BIGINT,
    "department" CITEXT,
    "division" CITEXT,
    "details" CITEXT NOT NULL,
    "due_date" DATE,
    "requester_signature" CITEXT,
    "requested_at" TIMESTAMP(0) NOT NULL,
    "person_name_th" CITEXT,
    "person_name_en" CITEXT,
    "device_name" CITEXT,
    "asset_tag" CITEXT,
    "asset_id" BIGINT,
    "symptom" CITEXT,
    "approver_id" BIGINT,
    "approved_at" TIMESTAMP(0),
    "assignee_id" BIGINT,
    "accepted_at" TIMESTAMP(0),
    "result" CITEXT,
    "completed_on" DATE,
    "work_start_on" DATE,
    "work_skip_off_days" BOOLEAN NOT NULL DEFAULT true,
    "cannot_reason" CITEXT,
    "repair_method" CITEXT,
    "external_vendor" CITEXT,
    "warranty" CITEXT,
    "repair_details" CITEXT,
    "staff_signature" CITEXT,
    "resulted_at" TIMESTAMP(0),
    "it_head_id" BIGINT,
    "it_head_signature" CITEXT,
    "approver_signature" CITEXT,
    "closed_at" TIMESTAMP(0),
    "source" CITEXT,
    "cancel_reason" CITEXT,
    "cancel_requested_at" TIMESTAMP(0),
    "cancel_requested_status" CITEXT,
    "cancelled_at" TIMESTAMP(0),
    "cancelled_by" BIGINT,
    "current_step" SMALLINT,
    "created_at" TIMESTAMP(0),
    "updated_at" TIMESTAMP(0),

    CONSTRAINT "it_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_batches" (
    "id" CITEXT NOT NULL,
    "name" CITEXT NOT NULL,
    "total_jobs" INTEGER NOT NULL,
    "pending_jobs" INTEGER NOT NULL,
    "failed_jobs" INTEGER NOT NULL,
    "failed_job_ids" CITEXT NOT NULL,
    "options" CITEXT,
    "cancelled_at" INTEGER,
    "created_at" INTEGER NOT NULL,
    "finished_at" INTEGER,

    CONSTRAINT "job_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jobs" (
    "id" BIGSERIAL NOT NULL,
    "queue" CITEXT NOT NULL,
    "payload" CITEXT NOT NULL,
    "attempts" SMALLINT NOT NULL,
    "reserved_at" INTEGER,
    "available_at" INTEGER NOT NULL,
    "created_at" INTEGER NOT NULL,

    CONSTRAINT "jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kpi_entries" (
    "id" BIGSERIAL NOT NULL,
    "user_id" BIGINT NOT NULL,
    "work_date" DATE NOT NULL,
    "details" CITEXT NOT NULL,
    "created_at" TIMESTAMP(0),
    "updated_at" TIMESTAMP(0),
    "entry_type" CITEXT NOT NULL DEFAULT 'work',
    "ticket_id" BIGINT,
    "requester_name" CITEXT,
    "branch_name" CITEXT,
    "service_type" CITEXT,
    "solution" CITEXT,
    "complexity" DECIMAL(3,1),
    "completed_date" DATE,

    CONSTRAINT "kpi_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "locations" (
    "id" BIGSERIAL NOT NULL,
    "code" CITEXT NOT NULL,
    "name" CITEXT NOT NULL,
    "type" CITEXT NOT NULL DEFAULT 'room',
    "parent_id" BIGINT,
    "branch_id" BIGINT,
    "address" CITEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(0),
    "updated_at" TIMESTAMP(0),
    "deleted_at" TIMESTAMP(0),

    CONSTRAINT "locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "migrations" (
    "id" SERIAL NOT NULL,
    "migration" CITEXT NOT NULL,
    "batch" INTEGER NOT NULL,

    CONSTRAINT "migrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" CITEXT NOT NULL,
    "type" CITEXT NOT NULL,
    "notifiable_type" CITEXT NOT NULL,
    "notifiable_id" BIGINT NOT NULL,
    "data" CITEXT NOT NULL,
    "read_at" TIMESTAMP(0),
    "created_at" TIMESTAMP(0),
    "updated_at" TIMESTAMP(0),
    "subject_ref" CITEXT GENERATED ALWAYS AS (eam_subject_ref("data"::text)) STORED,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "email" CITEXT NOT NULL,
    "token" CITEXT NOT NULL,
    "created_at" TIMESTAMP(0),

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("email")
);

-- CreateTable
CREATE TABLE "personal_access_tokens" (
    "id" BIGSERIAL NOT NULL,
    "tokenable_type" CITEXT NOT NULL,
    "tokenable_id" BIGINT NOT NULL,
    "name" CITEXT NOT NULL,
    "token" CITEXT NOT NULL,
    "abilities" CITEXT,
    "last_used_at" TIMESTAMP(0),
    "expires_at" TIMESTAMP(0),
    "created_at" TIMESTAMP(0),
    "updated_at" TIMESTAMP(0),
    "reauth_at" TIMESTAMP(0),

    CONSTRAINT "personal_access_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" CITEXT NOT NULL,
    "user_id" BIGINT,
    "ip_address" CITEXT,
    "user_agent" CITEXT,
    "payload" CITEXT NOT NULL,
    "last_activity" INTEGER NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" BIGSERIAL NOT NULL,
    "name" CITEXT NOT NULL,
    "username" CITEXT,
    "email" CITEXT,
    "role" CITEXT NOT NULL DEFAULT 'viewer',
    "job_title" CITEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "branch_id" BIGINT,
    "department" CITEXT,
    "division" CITEXT,
    "supervisor_id" BIGINT,
    "is_it_staff" BOOLEAN NOT NULL DEFAULT false,
    "is_it_head" BOOLEAN NOT NULL DEFAULT false,
    "is_it_manager" BOOLEAN NOT NULL DEFAULT false,
    "email_verified_at" TIMESTAMP(0),
    "password" CITEXT,
    "type" CITEXT NOT NULL DEFAULT 'LOCAL',
    "connection_id" BIGINT,
    "external_id" CITEXT,
    "external_synced_at" TIMESTAMP(0),
    "secret_pin_failures" SMALLINT NOT NULL DEFAULT 0,
    "secret_pin_locked_until" TIMESTAMP(0),
    "login_failures" SMALLINT NOT NULL DEFAULT 0,
    "login_locked_until" TIMESTAMP(0),
    "password_changed_at" TIMESTAMP(0),
    "must_change_password" BOOLEAN NOT NULL DEFAULT false,
    "password_self_changed_at" TIMESTAMP(0),
    "password_change_forced" BOOLEAN NOT NULL DEFAULT false,
    "last_login_at" TIMESTAMP(0),
    "last_login_failed_at" TIMESTAMP(0),
    "last_locked_at" TIMESTAMP(0),
    "last_lock_reason" CITEXT,
    "last_lock_attempts" INTEGER,
    "inactive_unlocked_at" TIMESTAMP(0),
    "external_status" CITEXT,
    "remember_token" CITEXT,
    "signature_path" CITEXT,
    "approval_route_id" BIGINT,
    "created_at" TIMESTAMP(0),
    "updated_at" TIMESTAMP(0),
    "calendar_token" CITEXT,
    "two_factor_secret" CITEXT,
    "two_factor_confirmed_at" TIMESTAMP(0),
    "two_factor_recovery_codes" CITEXT,
    "two_factor_last_step" BIGINT,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_connections" (
    "id" BIGSERIAL NOT NULL,
    "name" CITEXT NOT NULL,
    "is_enabled" BOOLEAN NOT NULL DEFAULT false,
    "base_url" CITEXT NOT NULL,
    "timeout_ms" INTEGER NOT NULL DEFAULT 10000,
    "login_method" CITEXT NOT NULL DEFAULT 'POST',
    "login_path" CITEXT NOT NULL,
    "login_username_field" CITEXT NOT NULL DEFAULT 'username',
    "login_password_field" CITEXT NOT NULL DEFAULT 'password',
    "login_body_type" CITEXT NOT NULL DEFAULT 'json',
    "profile_method" CITEXT NOT NULL DEFAULT 'GET',
    "profile_path" CITEXT,
    "profile_root_path" CITEXT,
    "logout_path" CITEXT,
    "refresh_path" CITEXT,
    "health_path" CITEXT,
    "token_path" CITEXT NOT NULL DEFAULT 'token',
    "token_ttl_path" CITEXT,
    "refresh_token_path" CITEXT,
    "default_token_ttl_seconds" INTEGER NOT NULL DEFAULT 86400,
    "profile_cache_seconds" INTEGER NOT NULL DEFAULT 600,
    "field_map" JSONB NOT NULL DEFAULT '{}',
    "role_rules" JSONB NOT NULL DEFAULT '[]',
    "default_role" CITEXT NOT NULL DEFAULT 'viewer',
    "error_code_path" CITEXT,
    "error_messages" JSONB NOT NULL DEFAULT '{}',
    "auth_type" CITEXT NOT NULL DEFAULT 'none',
    "auth_header_name" CITEXT,
    "auth_username" CITEXT,
    "auth_secret" CITEXT,
    "allowed_hosts" JSONB NOT NULL DEFAULT '[]',
    "max_redirects" SMALLINT NOT NULL DEFAULT 0,
    "register_url" CITEXT,
    "forgot_password_url" CITEXT,
    "change_password_url" CITEXT,
    "users_list_path" CITEXT,
    "users_list_root_path" CITEXT,
    "users_page_param" CITEXT,
    "users_page_size_param" CITEXT,
    "users_page_size" INTEGER NOT NULL DEFAULT 100,
    "active_values" JSONB NOT NULL DEFAULT '[]',
    "sync_interval_minutes" INTEGER NOT NULL DEFAULT 0,
    "last_synced_at" TIMESTAMP(0),
    "last_sync_result" JSONB,
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "created_at" TIMESTAMP(0),
    "updated_at" TIMESTAMP(0),

    CONSTRAINT "api_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_sessions" (
    "id" BIGSERIAL NOT NULL,
    "token_id" BIGINT NOT NULL,
    "user_id" BIGINT NOT NULL,
    "connection_id" BIGINT NOT NULL,
    "access_token" CITEXT NOT NULL,
    "refresh_token" CITEXT,
    "expires_at" TIMESTAMP(0) NOT NULL,
    "profile_checked_at" TIMESTAMP(0),
    "created_at" TIMESTAMP(0),
    "updated_at" TIMESTAMP(0),

    CONSTRAINT "external_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" BIGSERIAL NOT NULL,
    "key" CITEXT NOT NULL,
    "group" CITEXT NOT NULL,
    "name_th" CITEXT NOT NULL,
    "name_en" CITEXT NOT NULL,
    "sort_order" SMALLINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(0),
    "updated_at" TIMESTAMP(0),

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "role" CITEXT NOT NULL,
    "permission_id" BIGINT NOT NULL,
    "created_at" TIMESTAMP(0),

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role","permission_id")
);

-- CreateTable
CREATE TABLE "user_permissions" (
    "user_id" BIGINT NOT NULL,
    "permission_id" BIGINT NOT NULL,
    "effect" CITEXT NOT NULL,
    "created_by" BIGINT,
    "created_at" TIMESTAMP(0),
    "expires_on" DATE,

    CONSTRAINT "user_permissions_pkey" PRIMARY KEY ("user_id","permission_id")
);

-- CreateTable
CREATE TABLE "permission_groups" (
    "key" CITEXT NOT NULL,
    "name_th" CITEXT NOT NULL,
    "name_en" CITEXT NOT NULL,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" SMALLINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(0),
    "updated_at" TIMESTAMP(0),

    CONSTRAINT "permission_groups_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "user_groups" (
    "user_id" BIGINT NOT NULL,
    "group_key" CITEXT NOT NULL,
    "expires_on" DATE,
    "created_by" BIGINT,
    "created_at" TIMESTAMP(0),

    CONSTRAINT "user_groups_pkey" PRIMARY KEY ("user_id","group_key")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" BIGSERIAL NOT NULL,
    "actor_id" BIGINT,
    "action" CITEXT NOT NULL,
    "subject_type" CITEXT NOT NULL,
    "subject_id" CITEXT,
    "before" JSONB,
    "after" JSONB,
    "ip" CITEXT,
    "user_agent" CITEXT,
    "created_at" TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "departments" (
    "id" BIGSERIAL NOT NULL,
    "name" CITEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" SMALLINT NOT NULL DEFAULT 0,
    "division_id" BIGINT,
    "created_at" TIMESTAMP(0),
    "updated_at" TIMESTAMP(0),

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "divisions" (
    "id" BIGSERIAL NOT NULL,
    "name" CITEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" SMALLINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(0),
    "updated_at" TIMESTAMP(0),

    CONSTRAINT "divisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_signatures" (
    "id" BIGSERIAL NOT NULL,
    "user_id" BIGINT NOT NULL,
    "file_ref" CITEXT NOT NULL,
    "mime_type" CITEXT NOT NULL DEFAULT 'image/png',
    "size" INTEGER NOT NULL DEFAULT 0,
    "source" CITEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_encrypted" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT,

    CONSTRAINT "user_signatures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_requests" (
    "id" BIGSERIAL NOT NULL,
    "uuid" CITEXT NOT NULL,
    "user_id" BIGINT NOT NULL,
    "leave_type" CITEXT NOT NULL,
    "unit" CITEXT NOT NULL DEFAULT 'full',
    "start_on" DATE NOT NULL,
    "end_on" DATE NOT NULL,
    "start_time" CITEXT,
    "end_time" CITEXT,
    "days" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "reason" CITEXT,
    "approver_id" BIGINT,
    "status" CITEXT NOT NULL DEFAULT 'pending',
    "decided_at" TIMESTAMP(0),
    "decision_note" CITEXT,
    "cancelled_by" BIGINT,
    "created_at" TIMESTAMP(0),
    "updated_at" TIMESTAMP(0),

    CONSTRAINT "leave_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calendar_events" (
    "id" BIGSERIAL NOT NULL,
    "type" CITEXT NOT NULL DEFAULT 'onsite',
    "user_id" BIGINT NOT NULL,
    "ticket_id" BIGINT,
    "title" CITEXT NOT NULL,
    "start_on" DATE NOT NULL,
    "end_on" DATE NOT NULL,
    "note" CITEXT,
    "all_company" BOOLEAN NOT NULL DEFAULT false,
    "skip_weekends" BOOLEAN NOT NULL DEFAULT false,
    "created_by" BIGINT,
    "created_at" TIMESTAMP(0),
    "updated_at" TIMESTAMP(0),

    CONSTRAINT "calendar_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_holidays" (
    "id" BIGSERIAL NOT NULL,
    "calendar_id" BIGINT NOT NULL,
    "date" DATE NOT NULL,
    "name" CITEXT NOT NULL,
    "created_by" BIGINT,
    "created_at" TIMESTAMP(0),
    "updated_at" TIMESTAMP(0),

    CONSTRAINT "company_holidays_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "holiday_calendars" (
    "id" BIGSERIAL NOT NULL,
    "name" CITEXT NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" SMALLINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(0),
    "updated_at" TIMESTAMP(0),

    CONSTRAINT "holiday_calendars_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_quota_overrides" (
    "user_id" BIGINT NOT NULL,
    "year" SMALLINT NOT NULL,
    "leave_type" CITEXT NOT NULL,
    "days" DECIMAL(5,2) NOT NULL,
    "updated_by" BIGINT,
    "updated_at" TIMESTAMP(0),

    CONSTRAINT "leave_quota_overrides_pkey" PRIMARY KEY ("user_id","year","leave_type")
);

-- CreateTable
CREATE TABLE "leave_files" (
    "id" BIGSERIAL NOT NULL,
    "leave_id" BIGINT NOT NULL,
    "path" CITEXT NOT NULL,
    "original_name" CITEXT NOT NULL,
    "mime" CITEXT,
    "size" INTEGER,
    "created_at" TIMESTAMP(0),

    CONSTRAINT "leave_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meeting_rooms" (
    "id" BIGSERIAL NOT NULL,
    "name" CITEXT NOT NULL,
    "branch_id" BIGINT,
    "location" CITEXT,
    "room_no" CITEXT,
    "description" CITEXT,
    "seats" JSONB NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" SMALLINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(0),
    "updated_at" TIMESTAMP(0),

    CONSTRAINT "meeting_rooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meeting_room_images" (
    "id" BIGSERIAL NOT NULL,
    "room_id" BIGINT NOT NULL,
    "path" CITEXT NOT NULL,
    "size" INTEGER,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" SMALLINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(0),

    CONSTRAINT "meeting_room_images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meeting_bookings" (
    "id" BIGSERIAL NOT NULL,
    "uuid" CITEXT NOT NULL,
    "room_id" BIGINT NOT NULL,
    "user_id" BIGINT NOT NULL,
    "department" CITEXT,
    "title" CITEXT NOT NULL,
    "attendees" SMALLINT NOT NULL,
    "purpose" CITEXT,
    "note" CITEXT,
    "booking_date" DATE NOT NULL,
    "end_date" DATE,
    "start_time" CITEXT NOT NULL,
    "end_time" CITEXT NOT NULL,
    "status" CITEXT NOT NULL DEFAULT 'confirmed',
    "cancelled_at" TIMESTAMP(0),
    "cancelled_by" BIGINT,
    "created_at" TIMESTAMP(0),
    "updated_at" TIMESTAMP(0),
    "deleted_at" TIMESTAMP(0),

    CONSTRAINT "meeting_bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meeting_booking_equipment" (
    "booking_id" BIGINT NOT NULL,
    "name" CITEXT NOT NULL,

    CONSTRAINT "meeting_booking_equipment_pkey" PRIMARY KEY ("booking_id","name")
);

-- CreateTable
CREATE TABLE "vehicles" (
    "id" BIGSERIAL NOT NULL,
    "name" CITEXT NOT NULL,
    "plate_no" CITEXT,
    "branch_id" BIGINT,
    "seats" SMALLINT NOT NULL,
    "parking" CITEXT,
    "description" CITEXT,
    "mileage" INTEGER,
    "vehicle_type" CITEXT,
    "fuel_type" CITEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" SMALLINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(0),
    "updated_at" TIMESTAMP(0),

    CONSTRAINT "vehicles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_transfers" (
    "id" BIGSERIAL NOT NULL,
    "vehicle_id" BIGINT NOT NULL,
    "from_branch_id" BIGINT,
    "to_branch_id" BIGINT,
    "note" CITEXT,
    "created_by" BIGINT,
    "created_at" TIMESTAMP(0),

    CONSTRAINT "vehicle_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_images" (
    "id" BIGSERIAL NOT NULL,
    "vehicle_id" BIGINT NOT NULL,
    "path" CITEXT NOT NULL,
    "size" INTEGER,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" SMALLINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(0),

    CONSTRAINT "vehicle_images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_bookings" (
    "id" BIGSERIAL NOT NULL,
    "uuid" CITEXT NOT NULL,
    "vehicle_id" BIGINT,
    "user_id" BIGINT NOT NULL,
    "department" CITEXT,
    "details" CITEXT NOT NULL,
    "passengers" SMALLINT NOT NULL,
    "purpose" CITEXT,
    "note" CITEXT,
    "start_on" DATE NOT NULL,
    "start_time" CITEXT NOT NULL,
    "end_on" DATE NOT NULL,
    "end_time" CITEXT NOT NULL,
    "start_mileage" INTEGER,
    "end_mileage" INTEGER,
    "status" CITEXT NOT NULL DEFAULT 'confirmed',
    "assigned_by" BIGINT,
    "assigned_at" TIMESTAMP(0),
    "cancelled_at" TIMESTAMP(0),
    "cancelled_by" BIGINT,
    "approved_by" BIGINT,
    "approved_at" TIMESTAMP(0),
    "rejected_by" BIGINT,
    "rejected_at" TIMESTAMP(0),
    "reject_reason" CITEXT,
    "created_at" TIMESTAMP(0),
    "updated_at" TIMESTAMP(0),
    "deleted_at" TIMESTAMP(0),
    "branch_id" BIGINT,
    "needs_driver" BOOLEAN NOT NULL DEFAULT false,
    "driver_id" BIGINT,
    "cancel_reason" CITEXT,

    CONSTRAINT "vehicle_bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_booking_extras" (
    "booking_id" BIGINT NOT NULL,
    "name" CITEXT NOT NULL,

    CONSTRAINT "vehicle_booking_extras_pkey" PRIMARY KEY ("booking_id","name")
);

-- CreateTable
CREATE TABLE "equipment_loans" (
    "id" BIGSERIAL NOT NULL,
    "uuid" CITEXT NOT NULL,
    "asset_id" BIGINT,
    "user_id" BIGINT NOT NULL,
    "department" CITEXT,
    "purpose" CITEXT NOT NULL,
    "accessories" JSONB,
    "returned_accessories" JSONB,
    "photos" JSONB,
    "return_requested_at" TIMESTAMP(0),
    "note" CITEXT,
    "start_on" DATE NOT NULL,
    "start_time" CITEXT NOT NULL,
    "end_on" DATE NOT NULL,
    "end_time" CITEXT NOT NULL,
    "status" CITEXT NOT NULL DEFAULT 'reserved',
    "handed_out_at" TIMESTAMP(0),
    "handed_out_by" BIGINT,
    "returned_at" TIMESTAMP(0),
    "returned_by" BIGINT,
    "return_note" CITEXT,
    "overdue_notified_on" DATE,
    "cancelled_at" TIMESTAMP(0),
    "cancelled_by" BIGINT,
    "created_at" TIMESTAMP(0),
    "updated_at" TIMESTAMP(0),

    CONSTRAINT "equipment_loans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credential_access" (
    "id" BIGSERIAL NOT NULL,
    "credential_id" BIGINT NOT NULL,
    "user_id" BIGINT,
    "group_key" CITEXT,
    "created_by" BIGINT,
    "created_at" TIMESTAMP(0),

    CONSTRAINT "credential_access_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vpn_loans" (
    "id" BIGSERIAL NOT NULL,
    "uuid" CITEXT NOT NULL,
    "user_id" BIGINT NOT NULL,
    "department" CITEXT,
    "purpose" CITEXT NOT NULL,
    "requested_from" DATE,
    "requested_until" DATE,
    "status" CITEXT NOT NULL DEFAULT 'requested',
    "credential_id" BIGINT,
    "assigned_by" BIGINT,
    "assigned_at" TIMESTAMP(0),
    "start_on" DATE,
    "expires_on" DATE,
    "notify_days_before" SMALLINT NOT NULL DEFAULT 7,
    "reminded_for" DATE,
    "expired_notified_for" DATE,
    "renew_until" DATE,
    "choice_reason" CITEXT,
    "choice_at" TIMESTAMP(0),
    "ticket_id" BIGINT,
    "ended_at" TIMESTAMP(0),
    "ended_by" BIGINT,
    "end_note" CITEXT,
    "approved_by" BIGINT,
    "approved_at" TIMESTAMP(0),
    "received_at" TIMESTAMP(0),
    "revoked_at" TIMESTAMP(0),
    "revoked_by" BIGINT,
    "expired_notified_on" DATE,
    "created_at" TIMESTAMP(0),
    "updated_at" TIMESTAMP(0),

    CONSTRAINT "vpn_loans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "policy_acceptances" (
    "id" BIGSERIAL NOT NULL,
    "user_id" BIGINT NOT NULL,
    "version" INTEGER NOT NULL,
    "accepted_at" TIMESTAMP(0) NOT NULL,
    "ip" CITEXT,
    "user_agent" CITEXT,
    "name_stamp" CITEXT,
    "signature_path" CITEXT,
    "signature_at" TIMESTAMP(0),

    CONSTRAINT "policy_acceptances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "zoom_bookings" (
    "id" BIGSERIAL NOT NULL,
    "uuid" CITEXT NOT NULL,
    "user_id" BIGINT NOT NULL,
    "department" CITEXT,
    "branch_id" BIGINT,
    "title" CITEXT NOT NULL,
    "details" CITEXT,
    "start_on" DATE NOT NULL,
    "start_time" CITEXT NOT NULL,
    "end_on" DATE NOT NULL,
    "end_time" CITEXT NOT NULL,
    "status" CITEXT NOT NULL DEFAULT 'pending',
    "assignee_id" BIGINT,
    "accepted_at" TIMESTAMP(0),
    "meeting_link" CITEXT,
    "link_note" CITEXT,
    "meeting_topic" CITEXT,
    "meeting_id" CITEXT,
    "passcode" CITEXT,
    "zoom_account" CITEXT,
    "confirmed_by" BIGINT,
    "confirmed_at" TIMESTAMP(0),
    "link_received_at" TIMESTAMP(0),
    "reject_reason" CITEXT,
    "rejected_by" BIGINT,
    "rejected_at" TIMESTAMP(0),
    "cancelled_by" BIGINT,
    "cancelled_at" TIMESTAMP(0),
    "ticket_id" BIGINT,
    "meeting_booking_id" BIGINT,
    "created_at" TIMESTAMP(0),
    "updated_at" TIMESTAMP(0),

    CONSTRAINT "zoom_bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_versions" (
    "name" CITEXT NOT NULL,
    "version" BIGINT NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(0),

    CONSTRAINT "sync_versions_pkey" PRIMARY KEY ("name")
);

-- CreateTable
CREATE TABLE "vehicle_drivers" (
    "id" BIGSERIAL NOT NULL,
    "name" CITEXT NOT NULL,
    "nickname" CITEXT,
    "branch_id" BIGINT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" SMALLINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(0),
    "updated_at" TIMESTAMP(0),

    CONSTRAINT "vehicle_drivers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendors" (
    "id" BIGSERIAL NOT NULL,
    "name" CITEXT NOT NULL,
    "tax_id" CITEXT,
    "address" CITEXT NOT NULL,
    "contact_name" CITEXT NOT NULL,
    "contact_phone" CITEXT NOT NULL,
    "vendor_type" CITEXT NOT NULL,
    "map_url" CITEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(0),
    "updated_at" TIMESTAMP(0),
    "deleted_at" TIMESTAMP(0),

    CONSTRAINT "vendors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "announcement_files" (
    "id" BIGSERIAL NOT NULL,
    "announcement_id" BIGINT NOT NULL,
    "kind" CITEXT NOT NULL,
    "original_name" CITEXT NOT NULL,
    "path" CITEXT NOT NULL,
    "mime" CITEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "uploaded_by" BIGINT,
    "created_at" TIMESTAMP(0),
    "updated_at" TIMESTAMP(0),

    CONSTRAINT "announcement_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "policy_versions" (
    "version" INTEGER NOT NULL,
    "group_id" BIGINT NOT NULL,
    "title" CITEXT NOT NULL DEFAULT '',
    "sections" JSONB NOT NULL,
    "created_at" TIMESTAMP(0),
    "published_at" TIMESTAMP(0),
    "created_by" BIGINT,
    "updated_at" TIMESTAMP(0),

    CONSTRAINT "policy_versions_pkey" PRIMARY KEY ("version")
);

-- CreateTable
CREATE TABLE "policy_groups" (
    "id" BIGSERIAL NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "current_version" INTEGER,
    "created_at" TIMESTAMP(0),
    "updated_at" TIMESTAMP(0),

    CONSTRAINT "policy_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "policy_files" (
    "id" BIGSERIAL NOT NULL,
    "version" INTEGER,
    "original_name" CITEXT NOT NULL,
    "path" CITEXT NOT NULL,
    "mime" CITEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "uploaded_by" BIGINT,
    "created_at" TIMESTAMP(0),
    "updated_at" TIMESTAMP(0),

    CONSTRAINT "policy_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "other_policies" (
    "id" BIGSERIAL NOT NULL,
    "title" CITEXT NOT NULL,
    "description" CITEXT,
    "sections" JSONB,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" BIGINT,
    "created_at" TIMESTAMP(0),
    "updated_at" TIMESTAMP(0),

    CONSTRAINT "other_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "other_policy_files" (
    "id" BIGSERIAL NOT NULL,
    "other_policy_id" BIGINT NOT NULL,
    "original_name" CITEXT NOT NULL,
    "path" CITEXT NOT NULL,
    "mime" CITEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "uploaded_by" BIGINT,
    "created_at" TIMESTAMP(0),
    "updated_at" TIMESTAMP(0),

    CONSTRAINT "other_policy_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_files" (
    "id" BIGSERIAL NOT NULL,
    "vendor_id" BIGINT NOT NULL,
    "original_name" CITEXT NOT NULL,
    "path" CITEXT NOT NULL,
    "mime" CITEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "uploaded_by" BIGINT,
    "created_at" TIMESTAMP(0),
    "updated_at" TIMESTAMP(0),

    CONSTRAINT "vendor_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "repair_orders" (
    "id" BIGSERIAL NOT NULL,
    "uuid" CITEXT NOT NULL,
    "asset_id" BIGINT,
    "ticket_id" BIGINT,
    "item_no" CITEXT,
    "item_name" CITEXT NOT NULL,
    "symptom" CITEXT NOT NULL,
    "item_details" CITEXT,
    "document_no" CITEXT,
    "item_serial" CITEXT,
    "vendor_id" BIGINT NOT NULL,
    "sent_on" DATE NOT NULL,
    "sent_time" CITEXT NOT NULL,
    "sent_by_id" BIGINT,
    "sender_name" CITEXT,
    "follow_up_days" SMALLINT NOT NULL DEFAULT 7,
    "follow_up_on" DATE GENERATED ALWAYS AS ("sent_on" + "follow_up_days"::integer) STORED,
    "follow_up_notified_for" DATE,
    "status" CITEXT NOT NULL DEFAULT 'sent',
    "returned_at" TIMESTAMP(0),
    "received_by_id" BIGINT,
    "return_note" CITEXT,
    "asset_prev_status" CITEXT,
    "cancelled_at" TIMESTAMP(0),
    "cancelled_by_id" BIGINT,
    "cancel_reason" CITEXT,
    "created_by" BIGINT NOT NULL,
    "created_at" TIMESTAMP(0),
    "updated_at" TIMESTAMP(0),

    CONSTRAINT "repair_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "repair_order_parts" (
    "id" BIGSERIAL NOT NULL,
    "repair_order_id" BIGINT NOT NULL,
    "name" CITEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(0),

    CONSTRAINT "repair_order_parts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "repair_order_files" (
    "id" BIGSERIAL NOT NULL,
    "repair_order_id" BIGINT NOT NULL,
    "kind" CITEXT NOT NULL,
    "original_name" CITEXT NOT NULL,
    "path" CITEXT NOT NULL,
    "mime" CITEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "uploaded_by" BIGINT,
    "created_at" TIMESTAMP(0),
    "updated_at" TIMESTAMP(0),

    CONSTRAINT "repair_order_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_files" (
    "id" BIGSERIAL NOT NULL,
    "contract_id" BIGINT NOT NULL,
    "original_name" CITEXT NOT NULL,
    "path" CITEXT NOT NULL,
    "mime" CITEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "uploaded_by" BIGINT,
    "created_at" TIMESTAMP(0),
    "updated_at" TIMESTAMP(0),

    CONSTRAINT "contract_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fixed_assets" (
    "id" BIGSERIAL NOT NULL,
    "site" CITEXT NOT NULL,
    "fanum" CITEXT NOT NULL,
    "branch_id" BIGINT,
    "site_name" CITEXT,
    "description" CITEXT,
    "fa_class" CITEXT,
    "fa_dept" CITEXT,
    "fa_type" CITEXT,
    "fa_status" CITEXT,
    "fa_location" CITEXT,
    "acquired_on" DATE,
    "depr_start_on" DATE,
    "disposed_on" DATE,
    "acq_cost" DECIMAL(18,2),
    "accum_depr" DECIMAL(18,2),
    "nbv" DECIMAL(18,2),
    "salvage" DECIMAL(18,2),
    "depr_method" CITEXT,
    "depr_rate" DECIMAL(9,4),
    "useful_life" INTEGER,
    "source_data" JSONB NOT NULL,
    "row_hash" CITEXT NOT NULL,
    "source_recorded_at" TIMESTAMP(0),
    "as_of" DATE NOT NULL,
    "asset_id" BIGINT,
    "link_source" CITEXT,
    "linked_by" BIGINT,
    "missing_since" TIMESTAMP(0),
    "first_synced_at" TIMESTAMP(0) NOT NULL,
    "synced_at" TIMESTAMP(0) NOT NULL,
    "changed_at" TIMESTAMP(0),

    CONSTRAINT "fixed_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fixed_asset_classdepts" (
    "id" BIGSERIAL NOT NULL,
    "site" CITEXT NOT NULL,
    "class_dept" CITEXT NOT NULL,
    "description" CITEXT,
    "synced_at" TIMESTAMP(0) NOT NULL,

    CONSTRAINT "fixed_asset_classdepts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fixed_asset_sync_runs" (
    "id" BIGSERIAL NOT NULL,
    "run_trigger" CITEXT NOT NULL,
    "triggered_by" BIGINT,
    "status" CITEXT NOT NULL DEFAULT 'running',
    "stats" JSONB,
    "error" CITEXT,
    "started_at" TIMESTAMP(0) NOT NULL,
    "finished_at" TIMESTAMP(0),

    CONSTRAINT "fixed_asset_sync_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "app_settings_updated_by_index" ON "app_settings"("updated_by");

-- CreateIndex
CREATE INDEX "announcements_is_active_sort_order_index" ON "announcements"("is_active", "sort_order");

-- CreateIndex
CREATE INDEX "approval_routes_branch_id_is_active_index" ON "approval_routes"("branch_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "approval_route_steps_route_step_unique" ON "approval_route_steps"("approval_route_id", "step_no");

-- CreateIndex
CREATE INDEX "approval_step_approvers_user_id_index" ON "approval_step_approvers"("user_id");

-- CreateIndex
CREATE INDEX "it_ticket_approval_steps_acted_by_index" ON "it_ticket_approval_steps"("acted_by");

-- CreateIndex
CREATE UNIQUE INDEX "it_ticket_approval_steps_ticket_step_unique" ON "it_ticket_approval_steps"("it_ticket_id", "step_no");

-- CreateIndex
CREATE UNIQUE INDEX "asset_licenses_asset_id_unique" ON "asset_licenses"("asset_id");

-- CreateIndex
CREATE INDEX "asset_licenses_expires_at_index" ON "asset_licenses"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "licenses_uuid_unique" ON "licenses"("uuid");

-- CreateIndex
CREATE UNIQUE INDEX "licenses_license_no_unique" ON "licenses"("license_no");

-- CreateIndex
CREATE INDEX "licenses_expires_at_index" ON "licenses"("expires_at");

-- CreateIndex
CREATE INDEX "licenses_name_index" ON "licenses"("name");

-- CreateIndex
CREATE INDEX "license_files_license_id_index" ON "license_files"("license_id");

-- CreateIndex
CREATE INDEX "license_installations_license_active_index" ON "license_installations"("license_asset_id", "uninstalled_at");

-- CreateIndex
CREATE INDEX "license_installations_license_id_active_index" ON "license_installations"("license_id", "uninstalled_at");

-- CreateIndex
CREATE INDEX "license_installations_device_asset_id_index" ON "license_installations"("device_asset_id");

-- CreateIndex
CREATE INDEX "license_installations_user_id_index" ON "license_installations"("user_id");

-- CreateIndex
CREATE INDEX "license_installations_branch_id_index" ON "license_installations"("branch_id");

-- CreateIndex
CREATE INDEX "asset_files_asset_id_index" ON "asset_files"("asset_id");

-- CreateIndex
CREATE INDEX "asset_files_uploaded_by_index" ON "asset_files"("uploaded_by");

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
CREATE INDEX "asset_user_logs_asset_id_changed_at_index" ON "asset_user_logs"("asset_id", "changed_at");

-- CreateIndex
CREATE INDEX "asset_user_logs_performed_by_index" ON "asset_user_logs"("performed_by");

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
CREATE INDEX "assets_branch_id_index" ON "assets"("branch_id");

-- CreateIndex
CREATE INDEX "assets_cpu_tag_index" ON "assets"("cpu_tag");

-- CreateIndex
CREATE INDEX "assets_monitor_tag_index" ON "assets"("monitor_tag");

-- CreateIndex
CREATE UNIQUE INDEX "branches_code_unique" ON "branches"("code");

-- CreateIndex
CREATE UNIQUE INDEX "branches_work_group_unique" ON "branches"("work_group");

-- CreateIndex
CREATE INDEX "branches_is_active_sort_order_index" ON "branches"("is_active", "sort_order");

-- CreateIndex
CREATE INDEX "branches_holiday_calendar_id_index" ON "branches"("holiday_calendar_id");

-- CreateIndex
CREATE INDEX "cache_expiration_index" ON "cache"("expiration");

-- CreateIndex
CREATE INDEX "cache_locks_expiration_index" ON "cache_locks"("expiration");

-- CreateIndex
CREATE UNIQUE INDEX "contract_categories_name_unique" ON "contract_categories"("name");

-- CreateIndex
CREATE UNIQUE INDEX "contract_categories_builtin_key_unique" ON "contract_categories"("builtin_key");

-- CreateIndex
CREATE UNIQUE INDEX "dropdown_options_list_name_unique" ON "dropdown_options"("list", "name");

-- CreateIndex
CREATE INDEX "contracts_branch_id_index" ON "contracts"("branch_id");

-- CreateIndex
CREATE INDEX "contracts_category_id_index" ON "contracts"("category_id");

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
CREATE INDEX "it_ticket_attachments_event_id_index" ON "it_ticket_attachments"("event_id");

-- CreateIndex
CREATE INDEX "it_ticket_events_repair_order_id_index" ON "it_ticket_events"("repair_order_id");

-- CreateIndex
CREATE INDEX "it_ticket_events_it_ticket_id_created_at_index" ON "it_ticket_events"("it_ticket_id", "created_at");

-- CreateIndex
CREATE INDEX "it_ticket_events_user_id_index" ON "it_ticket_events"("user_id");

-- CreateIndex
CREATE INDEX "it_ticket_helpers_user_id_index" ON "it_ticket_helpers"("user_id");

-- CreateIndex
CREATE INDEX "it_ticket_helpers_added_by_index" ON "it_ticket_helpers"("added_by");

-- CreateIndex
CREATE UNIQUE INDEX "it_ticket_helpers_ticket_user_unique" ON "it_ticket_helpers"("it_ticket_id", "user_id");

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
CREATE INDEX "it_tickets_requested_at_index" ON "it_tickets"("requested_at");

-- CreateIndex
CREATE INDEX "jobs_queue_index" ON "jobs"("queue");

-- CreateIndex
CREATE INDEX "kpi_entries_user_id_work_date_index" ON "kpi_entries"("user_id", "work_date");

-- CreateIndex
CREATE INDEX "kpi_entries_work_date_index" ON "kpi_entries"("work_date");

-- CreateIndex
CREATE UNIQUE INDEX "kpi_entries_ticket_user_day_unique" ON "kpi_entries"("ticket_id", "user_id", "work_date");

-- CreateIndex
CREATE UNIQUE INDEX "locations_code_unique" ON "locations"("code");

-- CreateIndex
CREATE INDEX "locations_branch_id_index" ON "locations"("branch_id");

-- CreateIndex
CREATE INDEX "locations_is_active_name_index" ON "locations"("is_active", "name");

-- CreateIndex
CREATE INDEX "locations_parent_id_index" ON "locations"("parent_id");

-- CreateIndex
CREATE INDEX "notifications_subject_ref_read_at_index" ON "notifications"("subject_ref", "read_at");

-- CreateIndex
CREATE INDEX "notifications_notifiable_created_at_index" ON "notifications"("notifiable_type", "notifiable_id", "created_at");

-- CreateIndex
CREATE INDEX "notifications_notifiable_read_at_index" ON "notifications"("notifiable_type", "notifiable_id", "read_at");

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
CREATE UNIQUE INDEX "users_calendar_token_unique" ON "users"("calendar_token");

-- CreateIndex
CREATE INDEX "users_type_index" ON "users"("type");

-- CreateIndex
CREATE INDEX "users_branch_id_index" ON "users"("branch_id");

-- CreateIndex
CREATE INDEX "users_role_index" ON "users"("role");

-- CreateIndex
CREATE INDEX "users_supervisor_id_index" ON "users"("supervisor_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_connection_id_external_id_unique" ON "users"("connection_id", "external_id");

-- CreateIndex
CREATE UNIQUE INDEX "external_sessions_token_id_unique" ON "external_sessions"("token_id");

-- CreateIndex
CREATE INDEX "external_sessions_user_id_index" ON "external_sessions"("user_id");

-- CreateIndex
CREATE INDEX "external_sessions_expires_at_index" ON "external_sessions"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_key_unique" ON "permissions"("key");

-- CreateIndex
CREATE INDEX "user_groups_group_key_index" ON "user_groups"("group_key");

-- CreateIndex
CREATE INDEX "user_groups_created_by_index" ON "user_groups"("created_by");

-- CreateIndex
CREATE INDEX "audit_logs_subject_index" ON "audit_logs"("subject_type", "subject_id");

-- CreateIndex
CREATE INDEX "audit_logs_actor_id_index" ON "audit_logs"("actor_id");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_index" ON "audit_logs"("created_at");

-- CreateIndex
CREATE INDEX "audit_logs_action_index" ON "audit_logs"("action");

-- CreateIndex
CREATE UNIQUE INDEX "departments_name_unique" ON "departments"("name");

-- CreateIndex
CREATE INDEX "departments_division_id_index" ON "departments"("division_id");

-- CreateIndex
CREATE UNIQUE INDEX "divisions_name_unique" ON "divisions"("name");

-- CreateIndex
CREATE INDEX "user_signatures_user_id_is_active_index" ON "user_signatures"("user_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "leave_requests_uuid_unique" ON "leave_requests"("uuid");

-- CreateIndex
CREATE INDEX "leave_requests_user_id_status_index" ON "leave_requests"("user_id", "status");

-- CreateIndex
CREATE INDEX "leave_requests_approver_id_status_index" ON "leave_requests"("approver_id", "status");

-- CreateIndex
CREATE INDEX "leave_requests_start_on_end_on_index" ON "leave_requests"("start_on", "end_on");

-- CreateIndex
CREATE UNIQUE INDEX "calendar_events_ticket_id_unique" ON "calendar_events"("ticket_id");

-- CreateIndex
CREATE INDEX "calendar_events_user_id_index" ON "calendar_events"("user_id");

-- CreateIndex
CREATE INDEX "calendar_events_start_on_end_on_index" ON "calendar_events"("start_on", "end_on");

-- CreateIndex
CREATE UNIQUE INDEX "company_holidays_calendar_date_unique" ON "company_holidays"("calendar_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "holiday_calendars_name_unique" ON "holiday_calendars"("name");

-- CreateIndex
CREATE INDEX "leave_files_leave_id_index" ON "leave_files"("leave_id");

-- CreateIndex
CREATE UNIQUE INDEX "meeting_rooms_name_unique" ON "meeting_rooms"("name");

-- CreateIndex
CREATE INDEX "meeting_rooms_branch_id_index" ON "meeting_rooms"("branch_id");

-- CreateIndex
CREATE INDEX "meeting_room_images_room_id_index" ON "meeting_room_images"("room_id");

-- CreateIndex
CREATE UNIQUE INDEX "meeting_bookings_uuid_unique" ON "meeting_bookings"("uuid");

-- CreateIndex
CREATE INDEX "meeting_bookings_room_id_booking_date_index" ON "meeting_bookings"("room_id", "booking_date");

-- CreateIndex
CREATE INDEX "meeting_bookings_room_id_end_date_index" ON "meeting_bookings"("room_id", "end_date");

-- CreateIndex
CREATE INDEX "meeting_bookings_booking_date_index" ON "meeting_bookings"("booking_date");

-- CreateIndex
CREATE INDEX "meeting_bookings_user_id_index" ON "meeting_bookings"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "vehicles_name_unique" ON "vehicles"("name");

-- CreateIndex
CREATE UNIQUE INDEX "vehicles_plate_no_unique" ON "vehicles"("plate_no");

-- CreateIndex
CREATE INDEX "vehicles_branch_id_index" ON "vehicles"("branch_id");

-- CreateIndex
CREATE INDEX "vehicle_transfers_vehicle_id_created_at_index" ON "vehicle_transfers"("vehicle_id", "created_at");

-- CreateIndex
CREATE INDEX "vehicle_transfers_from_branch_id_index" ON "vehicle_transfers"("from_branch_id");

-- CreateIndex
CREATE INDEX "vehicle_transfers_to_branch_id_index" ON "vehicle_transfers"("to_branch_id");

-- CreateIndex
CREATE INDEX "vehicle_transfers_created_by_index" ON "vehicle_transfers"("created_by");

-- CreateIndex
CREATE INDEX "vehicle_images_vehicle_id_index" ON "vehicle_images"("vehicle_id");

-- CreateIndex
CREATE UNIQUE INDEX "vehicle_bookings_uuid_unique" ON "vehicle_bookings"("uuid");

-- CreateIndex
CREATE INDEX "vehicle_bookings_vehicle_id_start_on_end_on_index" ON "vehicle_bookings"("vehicle_id", "start_on", "end_on");

-- CreateIndex
CREATE INDEX "vehicle_bookings_start_on_end_on_index" ON "vehicle_bookings"("start_on", "end_on");

-- CreateIndex
CREATE INDEX "vehicle_bookings_user_id_index" ON "vehicle_bookings"("user_id");

-- CreateIndex
CREATE INDEX "vehicle_bookings_branch_id_index" ON "vehicle_bookings"("branch_id");

-- CreateIndex
CREATE INDEX "vehicle_bookings_driver_id_start_on_end_on_index" ON "vehicle_bookings"("driver_id", "start_on", "end_on");

-- CreateIndex
CREATE UNIQUE INDEX "equipment_loans_uuid_unique" ON "equipment_loans"("uuid");

-- CreateIndex
CREATE INDEX "equipment_loans_asset_id_start_on_end_on_index" ON "equipment_loans"("asset_id", "start_on", "end_on");

-- CreateIndex
CREATE INDEX "equipment_loans_start_on_end_on_index" ON "equipment_loans"("start_on", "end_on");

-- CreateIndex
CREATE INDEX "equipment_loans_user_id_index" ON "equipment_loans"("user_id");

-- CreateIndex
CREATE INDEX "equipment_loans_status_end_on_index" ON "equipment_loans"("status", "end_on");

-- CreateIndex
CREATE INDEX "equipment_loans_handed_out_by_index" ON "equipment_loans"("handed_out_by");

-- CreateIndex
CREATE INDEX "equipment_loans_returned_by_index" ON "equipment_loans"("returned_by");

-- CreateIndex
CREATE INDEX "equipment_loans_cancelled_by_index" ON "equipment_loans"("cancelled_by");

-- CreateIndex
CREATE INDEX "credential_access_user_id_index" ON "credential_access"("user_id");

-- CreateIndex
CREATE INDEX "credential_access_group_key_index" ON "credential_access"("group_key");

-- CreateIndex
CREATE INDEX "credential_access_created_by_index" ON "credential_access"("created_by");

-- CreateIndex
CREATE UNIQUE INDEX "credential_access_credential_id_user_id_unique" ON "credential_access"("credential_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "credential_access_credential_id_group_key_unique" ON "credential_access"("credential_id", "group_key");

-- CreateIndex
CREATE UNIQUE INDEX "vpn_loans_uuid_unique" ON "vpn_loans"("uuid");

-- CreateIndex
CREATE INDEX "vpn_loans_user_id_index" ON "vpn_loans"("user_id");

-- CreateIndex
CREATE INDEX "vpn_loans_status_expires_on_index" ON "vpn_loans"("status", "expires_on");

-- CreateIndex
CREATE INDEX "vpn_loans_credential_id_index" ON "vpn_loans"("credential_id");

-- CreateIndex
CREATE INDEX "vpn_loans_ticket_id_index" ON "vpn_loans"("ticket_id");

-- CreateIndex
CREATE INDEX "vpn_loans_assigned_by_index" ON "vpn_loans"("assigned_by");

-- CreateIndex
CREATE INDEX "vpn_loans_ended_by_index" ON "vpn_loans"("ended_by");

-- CreateIndex
CREATE INDEX "policy_acceptances_version_index" ON "policy_acceptances"("version");

-- CreateIndex
CREATE UNIQUE INDEX "policy_acceptances_user_version_unique" ON "policy_acceptances"("user_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "zoom_bookings_uuid_unique" ON "zoom_bookings"("uuid");

-- CreateIndex
CREATE INDEX "zoom_bookings_start_on_end_on_index" ON "zoom_bookings"("start_on", "end_on");

-- CreateIndex
CREATE INDEX "zoom_bookings_user_id_index" ON "zoom_bookings"("user_id");

-- CreateIndex
CREATE INDEX "zoom_bookings_status_index" ON "zoom_bookings"("status");

-- CreateIndex
CREATE INDEX "zoom_bookings_ticket_id_index" ON "zoom_bookings"("ticket_id");

-- CreateIndex
CREATE INDEX "zoom_bookings_meeting_booking_id_index" ON "zoom_bookings"("meeting_booking_id");

-- CreateIndex
CREATE INDEX "vehicle_drivers_branch_id_index" ON "vehicle_drivers"("branch_id");

-- CreateIndex
CREATE INDEX "vendors_name_index" ON "vendors"("name");

-- CreateIndex
CREATE INDEX "announcement_files_announcement_id_index" ON "announcement_files"("announcement_id");

-- CreateIndex
CREATE INDEX "announcement_files_uploaded_by_index" ON "announcement_files"("uploaded_by");

-- CreateIndex
CREATE INDEX "policy_versions_created_by_index" ON "policy_versions"("created_by");

-- CreateIndex
CREATE INDEX "policy_versions_group_id_index" ON "policy_versions"("group_id");

-- CreateIndex
CREATE INDEX "policy_groups_current_version_index" ON "policy_groups"("current_version");

-- CreateIndex
CREATE INDEX "policy_files_uploaded_by_index" ON "policy_files"("uploaded_by");

-- CreateIndex
CREATE INDEX "policy_files_version_index" ON "policy_files"("version");

-- CreateIndex
CREATE INDEX "other_policies_created_by_index" ON "other_policies"("created_by");

-- CreateIndex
CREATE INDEX "other_policy_files_other_policy_id_index" ON "other_policy_files"("other_policy_id");

-- CreateIndex
CREATE INDEX "other_policy_files_uploaded_by_index" ON "other_policy_files"("uploaded_by");

-- CreateIndex
CREATE INDEX "vendor_files_vendor_id_index" ON "vendor_files"("vendor_id");

-- CreateIndex
CREATE INDEX "vendor_files_uploaded_by_index" ON "vendor_files"("uploaded_by");

-- CreateIndex
CREATE UNIQUE INDEX "repair_orders_uuid_unique" ON "repair_orders"("uuid");

-- CreateIndex
CREATE INDEX "repair_orders_status_sent_on_index" ON "repair_orders"("status", "sent_on");

-- CreateIndex
CREATE INDEX "repair_orders_status_follow_up_on_index" ON "repair_orders"("status", "follow_up_on");

-- CreateIndex
CREATE INDEX "repair_orders_asset_id_index" ON "repair_orders"("asset_id");

-- CreateIndex
CREATE INDEX "repair_orders_ticket_id_index" ON "repair_orders"("ticket_id");

-- CreateIndex
CREATE INDEX "repair_orders_vendor_id_index" ON "repair_orders"("vendor_id");

-- CreateIndex
CREATE INDEX "repair_orders_sent_by_id_index" ON "repair_orders"("sent_by_id");

-- CreateIndex
CREATE INDEX "repair_orders_received_by_id_index" ON "repair_orders"("received_by_id");

-- CreateIndex
CREATE INDEX "repair_orders_created_by_index" ON "repair_orders"("created_by");

-- CreateIndex
CREATE INDEX "repair_orders_cancelled_by_id_index" ON "repair_orders"("cancelled_by_id");

-- CreateIndex
CREATE INDEX "repair_order_parts_repair_order_id_index" ON "repair_order_parts"("repair_order_id");

-- CreateIndex
CREATE INDEX "repair_order_files_repair_order_id_index" ON "repair_order_files"("repair_order_id");

-- CreateIndex
CREATE INDEX "repair_order_files_uploaded_by_index" ON "repair_order_files"("uploaded_by");

-- CreateIndex
CREATE INDEX "contract_files_contract_id_index" ON "contract_files"("contract_id");

-- CreateIndex
CREATE INDEX "contract_files_uploaded_by_index" ON "contract_files"("uploaded_by");

-- CreateIndex
CREATE INDEX "fixed_assets_fanum_index" ON "fixed_assets"("fanum");

-- CreateIndex
CREATE INDEX "fixed_assets_asset_id_index" ON "fixed_assets"("asset_id");

-- CreateIndex
CREATE INDEX "fixed_assets_branch_id_index" ON "fixed_assets"("branch_id");

-- CreateIndex
CREATE INDEX "fixed_assets_linked_by_index" ON "fixed_assets"("linked_by");

-- CreateIndex
CREATE INDEX "fixed_assets_fa_status_index" ON "fixed_assets"("fa_status");

-- CreateIndex
CREATE UNIQUE INDEX "fixed_assets_site_fanum_unique" ON "fixed_assets"("site", "fanum");

-- CreateIndex
CREATE UNIQUE INDEX "fixed_asset_classdepts_site_class_dept_unique" ON "fixed_asset_classdepts"("site", "class_dept");

-- CreateIndex
CREATE INDEX "fixed_asset_sync_runs_started_at_index" ON "fixed_asset_sync_runs"("started_at");

-- CreateIndex
CREATE INDEX "fixed_asset_sync_runs_triggered_by_index" ON "fixed_asset_sync_runs"("triggered_by");

-- AddForeignKey
ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_updated_by_foreign" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_created_by_foreign" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_routes" ADD CONSTRAINT "approval_routes_branch_id_foreign" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "approval_route_steps" ADD CONSTRAINT "approval_route_steps_approval_route_id_foreign" FOREIGN KEY ("approval_route_id") REFERENCES "approval_routes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_step_approvers" ADD CONSTRAINT "approval_step_approvers_step_id_foreign" FOREIGN KEY ("approval_route_step_id") REFERENCES "approval_route_steps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_step_approvers" ADD CONSTRAINT "approval_step_approvers_user_id_foreign" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "it_ticket_approval_steps" ADD CONSTRAINT "it_ticket_approval_steps_it_ticket_id_foreign" FOREIGN KEY ("it_ticket_id") REFERENCES "it_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "it_ticket_approval_steps" ADD CONSTRAINT "it_ticket_approval_steps_acted_by_foreign" FOREIGN KEY ("acted_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "asset_licenses" ADD CONSTRAINT "asset_licenses_cancelled_by_foreign" FOREIGN KEY ("cancelled_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "asset_licenses" ADD CONSTRAINT "asset_licenses_asset_id_foreign" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "licenses" ADD CONSTRAINT "licenses_location_id_foreign" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "licenses" ADD CONSTRAINT "licenses_branch_id_foreign" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "licenses" ADD CONSTRAINT "licenses_cancelled_by_foreign" FOREIGN KEY ("cancelled_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "licenses" ADD CONSTRAINT "licenses_created_by_foreign" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "licenses" ADD CONSTRAINT "licenses_updated_by_foreign" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "license_files" ADD CONSTRAINT "license_files_license_id_foreign" FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "license_files" ADD CONSTRAINT "license_files_uploaded_by_foreign" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "license_installations" ADD CONSTRAINT "license_installations_license_asset_id_foreign" FOREIGN KEY ("license_asset_id") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "license_installations" ADD CONSTRAINT "license_installations_device_asset_id_foreign" FOREIGN KEY ("device_asset_id") REFERENCES "assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "license_installations" ADD CONSTRAINT "license_installations_user_id_foreign" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "license_installations" ADD CONSTRAINT "license_installations_created_by_foreign" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "license_installations" ADD CONSTRAINT "license_installations_branch_id_foreign" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "license_installations" ADD CONSTRAINT "license_installations_license_id_foreign" FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "asset_files" ADD CONSTRAINT "asset_files_asset_id_foreign" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_files" ADD CONSTRAINT "asset_files_uploaded_by_foreign" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "asset_movements" ADD CONSTRAINT "asset_movements_from_branch_id_foreign" FOREIGN KEY ("from_branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "asset_movements" ADD CONSTRAINT "asset_movements_to_branch_id_foreign" FOREIGN KEY ("to_branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE RESTRICT;

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
ALTER TABLE "asset_user_logs" ADD CONSTRAINT "asset_user_logs_asset_id_foreign" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "asset_user_logs" ADD CONSTRAINT "asset_user_logs_performed_by_foreign" FOREIGN KEY ("performed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_branch_id_foreign" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_created_by_foreign" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_custodian_id_foreign" FOREIGN KEY ("custodian_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_location_id_foreign" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_updated_by_foreign" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "branches" ADD CONSTRAINT "branches_holiday_calendar_id_foreign" FOREIGN KEY ("holiday_calendar_id") REFERENCES "holiday_calendars"("id") ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_branch_id_foreign" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_category_id_foreign" FOREIGN KEY ("category_id") REFERENCES "contract_categories"("id") ON DELETE SET NULL ON UPDATE RESTRICT;

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
ALTER TABLE "it_ticket_attachments" ADD CONSTRAINT "it_ticket_attachments_event_id_foreign" FOREIGN KEY ("event_id") REFERENCES "it_ticket_events"("id") ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "it_ticket_attachments" ADD CONSTRAINT "it_ticket_attachments_uploaded_by_foreign" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "it_ticket_events" ADD CONSTRAINT "it_ticket_events_it_ticket_id_foreign" FOREIGN KEY ("it_ticket_id") REFERENCES "it_tickets"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "it_ticket_events" ADD CONSTRAINT "it_ticket_events_user_id_foreign" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "it_ticket_events" ADD CONSTRAINT "it_ticket_events_repair_order_id_foreign" FOREIGN KEY ("repair_order_id") REFERENCES "repair_orders"("id") ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "it_ticket_helpers" ADD CONSTRAINT "it_ticket_helpers_it_ticket_id_foreign" FOREIGN KEY ("it_ticket_id") REFERENCES "it_tickets"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "it_ticket_helpers" ADD CONSTRAINT "it_ticket_helpers_user_id_foreign" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "it_ticket_helpers" ADD CONSTRAINT "it_ticket_helpers_added_by_foreign" FOREIGN KEY ("added_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE RESTRICT;

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
ALTER TABLE "kpi_entries" ADD CONSTRAINT "kpi_entries_user_id_foreign" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kpi_entries" ADD CONSTRAINT "kpi_entries_ticket_id_foreign" FOREIGN KEY ("ticket_id") REFERENCES "it_tickets"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "locations" ADD CONSTRAINT "locations_parent_id_foreign" FOREIGN KEY ("parent_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "locations" ADD CONSTRAINT "locations_branch_id_foreign" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_approval_route_id_foreign" FOREIGN KEY ("approval_route_id") REFERENCES "approval_routes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_branch_id_foreign" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_supervisor_id_foreign" FOREIGN KEY ("supervisor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_connection_id_foreign" FOREIGN KEY ("connection_id") REFERENCES "api_connections"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "api_connections" ADD CONSTRAINT "api_connections_created_by_foreign" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_connections" ADD CONSTRAINT "api_connections_updated_by_foreign" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_sessions" ADD CONSTRAINT "external_sessions_token_id_foreign" FOREIGN KEY ("token_id") REFERENCES "personal_access_tokens"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_sessions" ADD CONSTRAINT "external_sessions_user_id_foreign" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_sessions" ADD CONSTRAINT "external_sessions_connection_id_foreign" FOREIGN KEY ("connection_id") REFERENCES "api_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_foreign" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_permissions" ADD CONSTRAINT "user_permissions_user_id_foreign" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_permissions" ADD CONSTRAINT "user_permissions_permission_id_foreign" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_permissions" ADD CONSTRAINT "user_permissions_created_by_foreign" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_groups" ADD CONSTRAINT "user_groups_user_id_foreign" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "user_groups" ADD CONSTRAINT "user_groups_group_key_foreign" FOREIGN KEY ("group_key") REFERENCES "permission_groups"("key") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "user_groups" ADD CONSTRAINT "user_groups_created_by_foreign" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_foreign" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_division_id_foreign" FOREIGN KEY ("division_id") REFERENCES "divisions"("id") ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "user_signatures" ADD CONSTRAINT "user_signatures_user_id_foreign" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_signatures" ADD CONSTRAINT "user_signatures_created_by_foreign" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_user_id_foreign" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_approver_id_foreign" FOREIGN KEY ("approver_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_user_id_foreign" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_ticket_id_foreign" FOREIGN KEY ("ticket_id") REFERENCES "it_tickets"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_created_by_foreign" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "company_holidays" ADD CONSTRAINT "company_holidays_created_by_foreign" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "company_holidays" ADD CONSTRAINT "company_holidays_calendar_id_foreign" FOREIGN KEY ("calendar_id") REFERENCES "holiday_calendars"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "leave_quota_overrides" ADD CONSTRAINT "leave_quota_overrides_user_id_foreign" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "leave_files" ADD CONSTRAINT "leave_files_leave_id_foreign" FOREIGN KEY ("leave_id") REFERENCES "leave_requests"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "meeting_rooms" ADD CONSTRAINT "meeting_rooms_branch_id_foreign" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "meeting_room_images" ADD CONSTRAINT "meeting_room_images_room_id_foreign" FOREIGN KEY ("room_id") REFERENCES "meeting_rooms"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "meeting_bookings" ADD CONSTRAINT "meeting_bookings_room_id_foreign" FOREIGN KEY ("room_id") REFERENCES "meeting_rooms"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "meeting_bookings" ADD CONSTRAINT "meeting_bookings_user_id_foreign" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "meeting_booking_equipment" ADD CONSTRAINT "meeting_booking_equipment_booking_id_foreign" FOREIGN KEY ("booking_id") REFERENCES "meeting_bookings"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_branch_id_foreign" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "vehicle_transfers" ADD CONSTRAINT "vehicle_transfers_vehicle_id_foreign" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "vehicle_transfers" ADD CONSTRAINT "vehicle_transfers_from_branch_id_foreign" FOREIGN KEY ("from_branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "vehicle_transfers" ADD CONSTRAINT "vehicle_transfers_to_branch_id_foreign" FOREIGN KEY ("to_branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "vehicle_transfers" ADD CONSTRAINT "vehicle_transfers_created_by_foreign" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "vehicle_images" ADD CONSTRAINT "vehicle_images_vehicle_id_foreign" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "vehicle_bookings" ADD CONSTRAINT "vehicle_bookings_branch_id_foreign" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "vehicle_bookings" ADD CONSTRAINT "vehicle_bookings_driver_id_foreign" FOREIGN KEY ("driver_id") REFERENCES "vehicle_drivers"("id") ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "vehicle_bookings" ADD CONSTRAINT "vehicle_bookings_vehicle_id_foreign" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "vehicle_bookings" ADD CONSTRAINT "vehicle_bookings_user_id_foreign" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "vehicle_booking_extras" ADD CONSTRAINT "vehicle_booking_extras_booking_id_foreign" FOREIGN KEY ("booking_id") REFERENCES "vehicle_bookings"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "equipment_loans" ADD CONSTRAINT "equipment_loans_asset_id_foreign" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "equipment_loans" ADD CONSTRAINT "equipment_loans_user_id_foreign" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "equipment_loans" ADD CONSTRAINT "equipment_loans_handed_out_by_foreign" FOREIGN KEY ("handed_out_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "equipment_loans" ADD CONSTRAINT "equipment_loans_returned_by_foreign" FOREIGN KEY ("returned_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "equipment_loans" ADD CONSTRAINT "equipment_loans_cancelled_by_foreign" FOREIGN KEY ("cancelled_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "credential_access" ADD CONSTRAINT "credential_access_credential_id_foreign" FOREIGN KEY ("credential_id") REFERENCES "credentials"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "credential_access" ADD CONSTRAINT "credential_access_user_id_foreign" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "credential_access" ADD CONSTRAINT "credential_access_created_by_foreign" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "vpn_loans" ADD CONSTRAINT "vpn_loans_user_id_foreign" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "vpn_loans" ADD CONSTRAINT "vpn_loans_credential_id_foreign" FOREIGN KEY ("credential_id") REFERENCES "credentials"("id") ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "vpn_loans" ADD CONSTRAINT "vpn_loans_assigned_by_foreign" FOREIGN KEY ("assigned_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "vpn_loans" ADD CONSTRAINT "vpn_loans_ended_by_foreign" FOREIGN KEY ("ended_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "vpn_loans" ADD CONSTRAINT "vpn_loans_ticket_id_foreign" FOREIGN KEY ("ticket_id") REFERENCES "it_tickets"("id") ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "policy_acceptances" ADD CONSTRAINT "policy_acceptances_user_id_foreign" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "zoom_bookings" ADD CONSTRAINT "zoom_bookings_user_id_foreign" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "zoom_bookings" ADD CONSTRAINT "zoom_bookings_ticket_id_foreign" FOREIGN KEY ("ticket_id") REFERENCES "it_tickets"("id") ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "zoom_bookings" ADD CONSTRAINT "zoom_bookings_meeting_booking_id_foreign" FOREIGN KEY ("meeting_booking_id") REFERENCES "meeting_bookings"("id") ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "vehicle_drivers" ADD CONSTRAINT "vehicle_drivers_branch_id_foreign" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "announcement_files" ADD CONSTRAINT "announcement_files_announcement_id_foreign" FOREIGN KEY ("announcement_id") REFERENCES "announcements"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "announcement_files" ADD CONSTRAINT "announcement_files_uploaded_by_foreign" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "policy_versions" ADD CONSTRAINT "policy_versions_created_by_foreign" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "policy_versions" ADD CONSTRAINT "policy_versions_group_id_foreign" FOREIGN KEY ("group_id") REFERENCES "policy_groups"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "policy_groups" ADD CONSTRAINT "policy_groups_current_version_foreign" FOREIGN KEY ("current_version") REFERENCES "policy_versions"("version") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "policy_files" ADD CONSTRAINT "policy_files_uploaded_by_foreign" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "policy_files" ADD CONSTRAINT "policy_files_version_foreign" FOREIGN KEY ("version") REFERENCES "policy_versions"("version") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "other_policies" ADD CONSTRAINT "other_policies_created_by_foreign" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "other_policy_files" ADD CONSTRAINT "other_policy_files_other_policy_id_foreign" FOREIGN KEY ("other_policy_id") REFERENCES "other_policies"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "other_policy_files" ADD CONSTRAINT "other_policy_files_uploaded_by_foreign" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "vendor_files" ADD CONSTRAINT "vendor_files_vendor_id_foreign" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "vendor_files" ADD CONSTRAINT "vendor_files_uploaded_by_foreign" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "repair_orders" ADD CONSTRAINT "repair_orders_asset_id_foreign" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "repair_orders" ADD CONSTRAINT "repair_orders_ticket_id_foreign" FOREIGN KEY ("ticket_id") REFERENCES "it_tickets"("id") ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "repair_orders" ADD CONSTRAINT "repair_orders_vendor_id_foreign" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "repair_orders" ADD CONSTRAINT "repair_orders_sent_by_id_foreign" FOREIGN KEY ("sent_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "repair_orders" ADD CONSTRAINT "repair_orders_received_by_id_foreign" FOREIGN KEY ("received_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "repair_orders" ADD CONSTRAINT "repair_orders_cancelled_by_id_foreign" FOREIGN KEY ("cancelled_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "repair_orders" ADD CONSTRAINT "repair_orders_created_by_foreign" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "repair_order_parts" ADD CONSTRAINT "repair_order_parts_repair_order_id_foreign" FOREIGN KEY ("repair_order_id") REFERENCES "repair_orders"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "repair_order_files" ADD CONSTRAINT "repair_order_files_repair_order_id_foreign" FOREIGN KEY ("repair_order_id") REFERENCES "repair_orders"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "repair_order_files" ADD CONSTRAINT "repair_order_files_uploaded_by_foreign" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "contract_files" ADD CONSTRAINT "contract_files_contract_id_foreign" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "contract_files" ADD CONSTRAINT "contract_files_uploaded_by_foreign" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_branch_id_foreign" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_asset_id_foreign" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_linked_by_foreign" FOREIGN KEY ("linked_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "fixed_asset_sync_runs" ADD CONSTRAINT "fixed_asset_sync_runs_triggered_by_foreign" FOREIGN KEY ("triggered_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE RESTRICT;


-- CHECK (เหมือน MySQL)
ALTER TABLE "users" ADD CONSTRAINT "users_type_check" CHECK ("type" IN ('LOCAL', 'API'));
ALTER TABLE "users" ADD CONSTRAINT "users_local_credentials_check" CHECK ("type" <> 'LOCAL' OR ("email" IS NOT NULL AND "password" IS NOT NULL));
ALTER TABLE "users" ADD CONSTRAINT "users_api_identity_check" CHECK ("type" <> 'API' OR ("connection_id" IS NOT NULL AND "external_id" IS NOT NULL AND "password" IS NULL));
ALTER TABLE "users" ADD CONSTRAINT "users_username_check" CHECK ("username" IS NULL OR "username" NOT LIKE '%@%');
ALTER TABLE "users" ADD CONSTRAINT "users_external_status_check" CHECK ("external_status" IS NULL OR "external_status" IN ('active', 'disabled', 'missing'));
ALTER TABLE "user_permissions" ADD CONSTRAINT "user_permissions_effect_check" CHECK ("effect" IN ('allow', 'deny'));
ALTER TABLE "api_connections" ADD CONSTRAINT "api_connections_auth_type_check" CHECK ("auth_type" IN ('none', 'api_key', 'bearer', 'basic'));
ALTER TABLE "user_signatures" ADD CONSTRAINT "user_signatures_source_check" CHECK ("source" IN ('UPLOAD', 'DRAW'));
