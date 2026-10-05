-- CreateTable
CREATE TABLE `app_settings` (
    `key` VARCHAR(100) NOT NULL,
    `value` JSON NULL,
    `updated_by` BIGINT NULL,
    `created_at` DATETIME(0) NULL,
    `updated_at` DATETIME(0) NULL,

    INDEX `app_settings_updated_by_index`(`updated_by`),
    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci;

-- CreateTable
CREATE TABLE `announcements` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `title` VARCHAR(200) NOT NULL,
    `body` TEXT NULL,
    `level` VARCHAR(20) NOT NULL DEFAULT 'info',
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `starts_on` DATE NULL,
    `ends_on` DATE NULL,
    `sort_order` SMALLINT NOT NULL DEFAULT 0,
    `created_by` BIGINT NULL,
    `created_at` DATETIME(0) NULL,
    `updated_at` DATETIME(0) NULL,

    INDEX `announcements_is_active_sort_order_index`(`is_active`, `sort_order`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci;

-- CreateTable
CREATE TABLE `approval_routes` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(255) NOT NULL,
    `branch_id` BIGINT NULL,
    `department` VARCHAR(100) NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(0) NULL,
    `updated_at` DATETIME(0) NULL,

    INDEX `approval_routes_branch_id_is_active_index`(`branch_id`, `is_active`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci;

-- CreateTable
CREATE TABLE `approval_route_steps` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `approval_route_id` BIGINT NOT NULL,
    `step_no` SMALLINT NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `created_at` DATETIME(0) NULL,
    `updated_at` DATETIME(0) NULL,

    UNIQUE INDEX `approval_route_steps_route_step_unique`(`approval_route_id`, `step_no`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci;

-- CreateTable
CREATE TABLE `approval_step_approvers` (
    `approval_route_step_id` BIGINT NOT NULL,
    `user_id` BIGINT NOT NULL,

    INDEX `approval_step_approvers_user_id_index`(`user_id`),
    PRIMARY KEY (`approval_route_step_id`, `user_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci;

-- CreateTable
CREATE TABLE `it_ticket_approval_steps` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `it_ticket_id` BIGINT NOT NULL,
    `step_no` SMALLINT NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `approver_ids` JSON NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'pending',
    `acted_by` BIGINT NULL,
    `acted_at` DATETIME(0) NULL,
    `comment` TEXT NULL,
    `created_at` DATETIME(0) NULL,
    `updated_at` DATETIME(0) NULL,

    INDEX `it_ticket_approval_steps_acted_by_index`(`acted_by`),
    UNIQUE INDEX `it_ticket_approval_steps_ticket_step_unique`(`it_ticket_id`, `step_no`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci;

-- CreateTable
CREATE TABLE `asset_licenses` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `asset_id` BIGINT NOT NULL,
    `billing` VARCHAR(20) NOT NULL,
    `start_date` DATE NOT NULL,
    `expires_at` DATE NULL,
    `seats` INTEGER NULL,
    `vendor` VARCHAR(255) NULL,
    `license_key` TEXT NULL,
    `notify_days_before` SMALLINT NULL,
    `notified_for_expires_at` DATE NULL,
    `created_at` DATETIME(0) NULL,
    `updated_at` DATETIME(0) NULL,

    UNIQUE INDEX `asset_licenses_asset_id_unique`(`asset_id`),
    INDEX `asset_licenses_expires_at_index`(`expires_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci;

-- CreateTable
CREATE TABLE `license_installations` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `license_asset_id` BIGINT NOT NULL,
    `device_asset_id` BIGINT NULL,
    `device_name` VARCHAR(255) NULL,
    `user_id` BIGINT NULL,
    `branch_id` BIGINT NULL,
    `installed_at` DATE NOT NULL,
    `uninstalled_at` DATE NULL,
    `notes` TEXT NULL,
    `created_by` BIGINT NULL,
    `created_at` DATETIME(0) NULL,
    `updated_at` DATETIME(0) NULL,

    INDEX `license_installations_license_active_index`(`license_asset_id`, `uninstalled_at`),
    INDEX `license_installations_device_asset_id_index`(`device_asset_id`),
    INDEX `license_installations_user_id_index`(`user_id`),
    INDEX `license_installations_branch_id_index`(`branch_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci;

-- CreateTable
CREATE TABLE `asset_files` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `asset_id` BIGINT NOT NULL,
    `kind` VARCHAR(20) NOT NULL DEFAULT 'license',
    `original_name` VARCHAR(255) NOT NULL,
    `path` VARCHAR(255) NOT NULL,
    `mime` VARCHAR(100) NOT NULL,
    `size` INTEGER NOT NULL,
    `uploaded_by` BIGINT NULL,
    `created_at` DATETIME(0) NULL,
    `updated_at` DATETIME(0) NULL,

    INDEX `asset_files_asset_id_index`(`asset_id`),
    INDEX `asset_files_uploaded_by_index`(`uploaded_by`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci;

-- CreateTable
CREATE TABLE `asset_movements` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `asset_id` BIGINT NOT NULL,
    `type` VARCHAR(20) NOT NULL,
    `from_location_id` BIGINT NULL,
    `to_location_id` BIGINT NULL,
    `from_custodian_id` BIGINT NULL,
    `to_custodian_id` BIGINT NULL,
    `moved_at` DATETIME(0) NOT NULL,
    `reason` TEXT NULL,
    `performed_by` BIGINT NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    INDEX `asset_movements_asset_id_moved_at_index`(`asset_id`, `moved_at`),
    INDEX `asset_movements_from_custodian_id_index`(`from_custodian_id`),
    INDEX `asset_movements_from_location_id_index`(`from_location_id`),
    INDEX `asset_movements_performed_by_index`(`performed_by`),
    INDEX `asset_movements_to_custodian_id_moved_at_index`(`to_custodian_id`, `moved_at`),
    INDEX `asset_movements_to_location_id_moved_at_index`(`to_location_id`, `moved_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci;

-- CreateTable
CREATE TABLE `assets` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `uuid` CHAR(36) NOT NULL,
    `asset_tag` VARCHAR(50) NOT NULL,
    `name` VARCHAR(255) NOT NULL,
    `category` VARCHAR(50) NOT NULL,
    `brand` VARCHAR(100) NULL,
    `model` VARCHAR(100) NULL,
    `serial_number` VARCHAR(100) NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'active',
    `location_id` BIGINT NULL,
    `custodian_id` BIGINT NULL,
    `purchase_date` DATE NULL,
    `purchase_cost` DECIMAL(15, 2) NULL,
    `warranty_expires_at` DATE NULL,
    `notes` TEXT NULL,
    `created_by` BIGINT NULL,
    `updated_by` BIGINT NULL,
    `created_at` DATETIME(0) NULL,
    `updated_at` DATETIME(0) NULL,
    `deleted_at` DATETIME(0) NULL,

    UNIQUE INDEX `assets_uuid_unique`(`uuid`),
    UNIQUE INDEX `assets_asset_tag_unique`(`asset_tag`),
    INDEX `assets_category_status_index`(`category`, `status`),
    INDEX `assets_created_by_index`(`created_by`),
    INDEX `assets_custodian_id_index`(`custodian_id`),
    INDEX `assets_deleted_at_created_at_index`(`deleted_at`, `created_at`),
    INDEX `assets_location_id_index`(`location_id`),
    INDEX `assets_serial_number_index`(`serial_number`),
    INDEX `assets_status_location_id_index`(`status`, `location_id`),
    INDEX `assets_updated_by_index`(`updated_by`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci;

-- CreateTable
CREATE TABLE `branches` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(30) NOT NULL,
    `name` VARCHAR(255) NOT NULL,
    `sort_order` SMALLINT NOT NULL DEFAULT 0,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(0) NULL,
    `updated_at` DATETIME(0) NULL,
    `deleted_at` DATETIME(0) NULL,

    UNIQUE INDEX `branches_code_unique`(`code`),
    INDEX `branches_is_active_sort_order_index`(`is_active`, `sort_order`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci;

-- CreateTable
CREATE TABLE `cache` (
    `key` VARCHAR(255) NOT NULL,
    `value` TEXT NOT NULL,
    `expiration` BIGINT NOT NULL,

    INDEX `cache_expiration_index`(`expiration`),
    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci;

-- CreateTable
CREATE TABLE `cache_locks` (
    `key` VARCHAR(255) NOT NULL,
    `owner` VARCHAR(255) NOT NULL,
    `expiration` BIGINT NOT NULL,

    INDEX `cache_locks_expiration_index`(`expiration`),
    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci;

-- CreateTable
CREATE TABLE `contracts` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `title` VARCHAR(255) NOT NULL,
    `vendor_name` VARCHAR(255) NOT NULL,
    `contract_no` VARCHAR(100) NULL,
    `start_date` DATE NOT NULL,
    `end_date` DATE NOT NULL,
    `amount` DECIMAL(15, 2) NULL,
    `contact_name` VARCHAR(255) NULL,
    `contact_email` VARCHAR(255) NULL,
    `contact_phone` VARCHAR(50) NULL,
    `notify_days_before` SMALLINT NULL,
    `notify_enabled` BOOLEAN NOT NULL DEFAULT true,
    `notified_for_end_date` DATE NULL,
    `notified_at` DATETIME(0) NULL,
    `notes` TEXT NULL,
    `branch_id` BIGINT NULL,
    `created_by` BIGINT NULL,
    `created_at` DATETIME(0) NULL,
    `updated_at` DATETIME(0) NULL,
    `deleted_at` DATETIME(0) NULL,

    INDEX `contracts_branch_id_index`(`branch_id`),
    INDEX `contracts_created_by_index`(`created_by`),
    INDEX `contracts_end_date_notify_enabled_index`(`end_date`, `notify_enabled`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci;

-- CreateTable
CREATE TABLE `credential_access_logs` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `credential_id` BIGINT NOT NULL,
    `user_id` BIGINT NULL,
    `action` VARCHAR(20) NOT NULL,
    `ip` VARCHAR(45) NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    INDEX `credential_access_logs_credential_id_created_at_index`(`credential_id`, `created_at`),
    INDEX `credential_access_logs_user_id_index`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci;

-- CreateTable
CREATE TABLE `credentials` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `title` VARCHAR(255) NOT NULL,
    `category` VARCHAR(30) NOT NULL DEFAULT 'system',
    `url` VARCHAR(500) NULL,
    `username` VARCHAR(255) NULL,
    `password` TEXT NULL,
    `secret_notes` TEXT NULL,
    `notes` TEXT NULL,
    `branch_id` BIGINT NULL,
    `owner_id` BIGINT NULL,
    `expires_at` DATE NULL,
    `notified_for_expires_at` DATE NULL,
    `created_by` BIGINT NULL,
    `updated_by` BIGINT NULL,
    `password_changed_at` DATETIME(0) NULL,
    `created_at` DATETIME(0) NULL,
    `updated_at` DATETIME(0) NULL,
    `deleted_at` DATETIME(0) NULL,

    INDEX `credentials_branch_id_index`(`branch_id`),
    INDEX `credentials_category_title_index`(`category`, `title`),
    INDEX `credentials_created_by_index`(`created_by`),
    INDEX `credentials_owner_id_index`(`owner_id`),
    INDEX `credentials_updated_by_index`(`updated_by`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci;

-- CreateTable
CREATE TABLE `failed_jobs` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `uuid` VARCHAR(255) NOT NULL,
    `connection` VARCHAR(255) NOT NULL,
    `queue` VARCHAR(255) NOT NULL,
    `payload` TEXT NOT NULL,
    `exception` TEXT NOT NULL,
    `failed_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    UNIQUE INDEX `failed_jobs_uuid_unique`(`uuid`),
    INDEX `failed_jobs_connection_queue_failed_at_index`(`connection`, `queue`, `failed_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci;

-- CreateTable
CREATE TABLE `it_ticket_attachments` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `it_ticket_id` BIGINT NOT NULL,
    `kind` VARCHAR(20) NOT NULL,
    `path` VARCHAR(255) NOT NULL,
    `original_name` VARCHAR(255) NULL,
    `mime` VARCHAR(100) NULL,
    `size` INTEGER NOT NULL DEFAULT 0,
    `uploaded_by` BIGINT NULL,
    `created_at` DATETIME(0) NULL,
    `updated_at` DATETIME(0) NULL,

    INDEX `it_ticket_attachments_it_ticket_id_kind_index`(`it_ticket_id`, `kind`),
    INDEX `it_ticket_attachments_uploaded_by_index`(`uploaded_by`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci;

-- CreateTable
CREATE TABLE `it_ticket_events` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `it_ticket_id` BIGINT NOT NULL,
    `user_id` BIGINT NULL,
    `action` VARCHAR(30) NOT NULL,
    `comment` TEXT NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    INDEX `it_ticket_events_it_ticket_id_created_at_index`(`it_ticket_id`, `created_at`),
    INDEX `it_ticket_events_user_id_index`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci;

-- CreateTable
CREATE TABLE `it_ticket_parts` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `it_ticket_id` BIGINT NOT NULL,
    `name` VARCHAR(255) NOT NULL,
    `quantity` SMALLINT NOT NULL DEFAULT 1,
    `photo_path` VARCHAR(255) NULL,
    `created_at` DATETIME(0) NULL,
    `updated_at` DATETIME(0) NULL,

    INDEX `it_ticket_parts_it_ticket_id_index`(`it_ticket_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci;

-- CreateTable
CREATE TABLE `it_tickets` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `uuid` CHAR(36) NOT NULL,
    `ticket_no` VARCHAR(30) NOT NULL,
    `type` VARCHAR(20) NOT NULL,
    `type_other` VARCHAR(255) NULL,
    `status` VARCHAR(30) NOT NULL DEFAULT 'pending_supervisor',
    `requester_id` BIGINT NOT NULL,
    `branch_id` BIGINT NULL,
    `department` VARCHAR(100) NULL,
    `division` VARCHAR(100) NULL,
    `details` TEXT NOT NULL,
    `due_date` DATE NULL,
    `requester_signature` VARCHAR(255) NULL,
    `requested_at` DATETIME(0) NOT NULL,
    `person_name_th` VARCHAR(255) NULL,
    `person_name_en` VARCHAR(255) NULL,
    `device_name` VARCHAR(255) NULL,
    `asset_tag` VARCHAR(50) NULL,
    `asset_id` BIGINT NULL,
    `symptom` TEXT NULL,
    `approver_id` BIGINT NULL,
    `approved_at` DATETIME(0) NULL,
    `assignee_id` BIGINT NULL,
    `accepted_at` DATETIME(0) NULL,
    `result` VARCHAR(20) NULL,
    `completed_on` DATE NULL,
    `cannot_reason` TEXT NULL,
    `repair_method` VARCHAR(20) NULL,
    `external_vendor` VARCHAR(255) NULL,
    `warranty` VARCHAR(20) NULL,
    `repair_details` TEXT NULL,
    `staff_signature` VARCHAR(255) NULL,
    `resulted_at` DATETIME(0) NULL,
    `it_head_id` BIGINT NULL,
    `it_head_signature` VARCHAR(255) NULL,
    `closed_at` DATETIME(0) NULL,
    `cancel_reason` TEXT NULL,
    `cancel_requested_at` DATETIME(0) NULL,
    `cancel_requested_status` VARCHAR(30) NULL,
    `cancelled_at` DATETIME(0) NULL,
    `cancelled_by` BIGINT NULL,
    `current_step` SMALLINT NULL,
    `created_at` DATETIME(0) NULL,
    `updated_at` DATETIME(0) NULL,

    UNIQUE INDEX `it_tickets_uuid_unique`(`uuid`),
    UNIQUE INDEX `it_tickets_ticket_no_unique`(`ticket_no`),
    INDEX `it_tickets_approver_id_status_index`(`approver_id`, `status`),
    INDEX `it_tickets_asset_id_index`(`asset_id`),
    INDEX `it_tickets_assignee_id_status_index`(`assignee_id`, `status`),
    INDEX `it_tickets_branch_id_index`(`branch_id`),
    INDEX `it_tickets_it_head_id_index`(`it_head_id`),
    INDEX `it_tickets_requester_id_created_at_index`(`requester_id`, `created_at`),
    INDEX `it_tickets_status_created_at_index`(`status`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci;

-- CreateTable
CREATE TABLE `job_batches` (
    `id` VARCHAR(255) NOT NULL,
    `name` VARCHAR(255) NOT NULL,
    `total_jobs` INTEGER NOT NULL,
    `pending_jobs` INTEGER NOT NULL,
    `failed_jobs` INTEGER NOT NULL,
    `failed_job_ids` TEXT NOT NULL,
    `options` TEXT NULL,
    `cancelled_at` INTEGER NULL,
    `created_at` INTEGER NOT NULL,
    `finished_at` INTEGER NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci;

-- CreateTable
CREATE TABLE `jobs` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `queue` VARCHAR(255) NOT NULL,
    `payload` TEXT NOT NULL,
    `attempts` SMALLINT NOT NULL,
    `reserved_at` INTEGER NULL,
    `available_at` INTEGER NOT NULL,
    `created_at` INTEGER NOT NULL,

    INDEX `jobs_queue_index`(`queue`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci;

-- CreateTable
CREATE TABLE `kpi_entries` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT NOT NULL,
    `work_date` DATE NOT NULL,
    `details` TEXT NOT NULL,
    `created_at` DATETIME(0) NULL,
    `updated_at` DATETIME(0) NULL,

    INDEX `kpi_entries_user_id_work_date_index`(`user_id`, `work_date`),
    INDEX `kpi_entries_work_date_index`(`work_date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci;

-- CreateTable
CREATE TABLE `locations` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(50) NOT NULL,
    `name` VARCHAR(255) NOT NULL,
    `type` VARCHAR(20) NOT NULL DEFAULT 'room',
    `parent_id` BIGINT NULL,
    `address` TEXT NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(0) NULL,
    `updated_at` DATETIME(0) NULL,
    `deleted_at` DATETIME(0) NULL,

    UNIQUE INDEX `locations_code_unique`(`code`),
    INDEX `locations_is_active_name_index`(`is_active`, `name`),
    INDEX `locations_parent_id_index`(`parent_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci;

-- CreateTable
CREATE TABLE `migrations` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `migration` VARCHAR(255) NOT NULL,
    `batch` INTEGER NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci;

-- CreateTable
CREATE TABLE `notifications` (
    `id` CHAR(36) NOT NULL,
    `type` VARCHAR(255) NOT NULL,
    `notifiable_type` VARCHAR(255) NOT NULL,
    `notifiable_id` BIGINT NOT NULL,
    `data` TEXT NOT NULL,
    `read_at` DATETIME(0) NULL,
    `created_at` DATETIME(0) NULL,
    `updated_at` DATETIME(0) NULL,

    INDEX `notifications_notifiable_type_notifiable_id_index`(`notifiable_type`, `notifiable_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci;

-- CreateTable
CREATE TABLE `password_reset_tokens` (
    `email` VARCHAR(255) NOT NULL,
    `token` VARCHAR(255) NOT NULL,
    `created_at` DATETIME(0) NULL,

    PRIMARY KEY (`email`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci;

-- CreateTable
CREATE TABLE `personal_access_tokens` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `tokenable_type` VARCHAR(255) NOT NULL,
    `tokenable_id` BIGINT NOT NULL,
    `name` TEXT NOT NULL,
    `token` VARCHAR(64) NOT NULL,
    `abilities` TEXT NULL,
    `last_used_at` DATETIME(0) NULL,
    `expires_at` DATETIME(0) NULL,
    `created_at` DATETIME(0) NULL,
    `updated_at` DATETIME(0) NULL,

    UNIQUE INDEX `personal_access_tokens_token_unique`(`token`),
    INDEX `personal_access_tokens_expires_at_index`(`expires_at`),
    INDEX `personal_access_tokens_tokenable_type_tokenable_id_index`(`tokenable_type`, `tokenable_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci;

-- CreateTable
CREATE TABLE `sessions` (
    `id` VARCHAR(255) NOT NULL,
    `user_id` BIGINT NULL,
    `ip_address` VARCHAR(45) NULL,
    `user_agent` TEXT NULL,
    `payload` TEXT NOT NULL,
    `last_activity` INTEGER NOT NULL,

    INDEX `sessions_last_activity_index`(`last_activity`),
    INDEX `sessions_user_id_index`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci;

-- CreateTable
CREATE TABLE `users` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(255) NOT NULL,
    `username` VARCHAR(50) NULL,
    `email` VARCHAR(255) NULL,
    `role` VARCHAR(20) NOT NULL DEFAULT 'viewer',
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `branch_id` BIGINT NULL,
    `department` VARCHAR(100) NULL,
    `division` VARCHAR(100) NULL,
    `supervisor_id` BIGINT NULL,
    `is_it_staff` BOOLEAN NOT NULL DEFAULT false,
    `is_it_head` BOOLEAN NOT NULL DEFAULT false,
    `email_verified_at` DATETIME(0) NULL,
    `password` VARCHAR(255) NULL,
    `type` VARCHAR(10) NOT NULL DEFAULT 'LOCAL',
    `connection_id` BIGINT NULL,
    `external_id` VARCHAR(191) NULL,
    `external_synced_at` DATETIME(0) NULL,
    `external_status` VARCHAR(20) NULL,
    `remember_token` VARCHAR(100) NULL,
    `signature_path` VARCHAR(255) NULL,
    `approval_route_id` BIGINT NULL,
    `created_at` DATETIME(0) NULL,
    `updated_at` DATETIME(0) NULL,

    UNIQUE INDEX `users_email_unique`(`email`),
    INDEX `users_type_index`(`type`),
    INDEX `users_branch_id_index`(`branch_id`),
    INDEX `users_role_index`(`role`),
    INDEX `users_supervisor_id_index`(`supervisor_id`),
    UNIQUE INDEX `users_connection_id_external_id_unique`(`connection_id`, `external_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci;

-- CreateTable
CREATE TABLE `api_connections` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(100) NOT NULL,
    `is_enabled` BOOLEAN NOT NULL DEFAULT false,
    `base_url` VARCHAR(500) NOT NULL,
    `timeout_ms` INTEGER NOT NULL DEFAULT 10000,
    `login_method` VARCHAR(10) NOT NULL DEFAULT 'POST',
    `login_path` VARCHAR(255) NOT NULL,
    `login_username_field` VARCHAR(100) NOT NULL DEFAULT 'username',
    `login_password_field` VARCHAR(100) NOT NULL DEFAULT 'password',
    `login_body_type` VARCHAR(10) NOT NULL DEFAULT 'json',
    `profile_method` VARCHAR(10) NOT NULL DEFAULT 'GET',
    `profile_path` VARCHAR(255) NULL,
    `profile_root_path` VARCHAR(255) NULL,
    `logout_path` VARCHAR(255) NULL,
    `refresh_path` VARCHAR(255) NULL,
    `token_path` VARCHAR(255) NOT NULL DEFAULT 'token',
    `token_ttl_path` VARCHAR(255) NULL,
    `refresh_token_path` VARCHAR(255) NULL,
    `default_token_ttl_seconds` INTEGER NOT NULL DEFAULT 86400,
    `profile_cache_seconds` INTEGER NOT NULL DEFAULT 600,
    `field_map` JSON NOT NULL DEFAULT (JSON_OBJECT()),
    `role_rules` JSON NOT NULL DEFAULT (JSON_ARRAY()),
    `default_role` VARCHAR(20) NOT NULL DEFAULT 'viewer',
    `error_code_path` VARCHAR(255) NULL,
    `error_messages` JSON NOT NULL DEFAULT (JSON_OBJECT()),
    `auth_type` VARCHAR(20) NOT NULL DEFAULT 'none',
    `auth_header_name` VARCHAR(100) NULL,
    `auth_username` VARCHAR(255) NULL,
    `auth_secret` TEXT NULL,
    `allowed_hosts` JSON NOT NULL DEFAULT (JSON_ARRAY()),
    `max_redirects` SMALLINT NOT NULL DEFAULT 0,
    `register_url` VARCHAR(500) NULL,
    `forgot_password_url` VARCHAR(500) NULL,
    `change_password_url` VARCHAR(500) NULL,
    `users_list_path` VARCHAR(255) NULL,
    `users_list_root_path` VARCHAR(255) NULL,
    `users_page_param` VARCHAR(50) NULL,
    `users_page_size_param` VARCHAR(50) NULL,
    `users_page_size` INTEGER NOT NULL DEFAULT 100,
    `active_values` JSON NOT NULL DEFAULT (JSON_ARRAY()),
    `sync_interval_minutes` INTEGER NOT NULL DEFAULT 0,
    `last_synced_at` DATETIME(0) NULL,
    `last_sync_result` JSON NULL,
    `created_by` BIGINT NULL,
    `updated_by` BIGINT NULL,
    `created_at` DATETIME(0) NULL,
    `updated_at` DATETIME(0) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci;

-- CreateTable
CREATE TABLE `external_sessions` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `token_id` BIGINT NOT NULL,
    `user_id` BIGINT NOT NULL,
    `connection_id` BIGINT NOT NULL,
    `access_token` TEXT NOT NULL,
    `refresh_token` TEXT NULL,
    `expires_at` DATETIME(0) NOT NULL,
    `profile_checked_at` DATETIME(0) NULL,
    `created_at` DATETIME(0) NULL,
    `updated_at` DATETIME(0) NULL,

    UNIQUE INDEX `external_sessions_token_id_unique`(`token_id`),
    INDEX `external_sessions_user_id_index`(`user_id`),
    INDEX `external_sessions_expires_at_index`(`expires_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci;

-- CreateTable
CREATE TABLE `permissions` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `key` VARCHAR(100) NOT NULL,
    `group` VARCHAR(50) NOT NULL,
    `name_th` VARCHAR(200) NOT NULL,
    `name_en` VARCHAR(200) NOT NULL,
    `sort_order` SMALLINT NOT NULL DEFAULT 0,
    `created_at` DATETIME(0) NULL,
    `updated_at` DATETIME(0) NULL,

    UNIQUE INDEX `permissions_key_unique`(`key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci;

-- CreateTable
CREATE TABLE `role_permissions` (
    `role` VARCHAR(20) NOT NULL,
    `permission_id` BIGINT NOT NULL,
    `created_at` DATETIME(0) NULL,

    PRIMARY KEY (`role`, `permission_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci;

-- CreateTable
CREATE TABLE `user_permissions` (
    `user_id` BIGINT NOT NULL,
    `permission_id` BIGINT NOT NULL,
    `effect` VARCHAR(10) NOT NULL,
    `created_by` BIGINT NULL,
    `created_at` DATETIME(0) NULL,

    PRIMARY KEY (`user_id`, `permission_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci;

-- CreateTable
CREATE TABLE `audit_logs` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `actor_id` BIGINT NULL,
    `action` VARCHAR(100) NOT NULL,
    `subject_type` VARCHAR(50) NOT NULL,
    `subject_id` VARCHAR(64) NULL,
    `before` JSON NULL,
    `after` JSON NULL,
    `ip` VARCHAR(45) NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    INDEX `audit_logs_subject_index`(`subject_type`, `subject_id`),
    INDEX `audit_logs_actor_id_index`(`actor_id`),
    INDEX `audit_logs_created_at_index`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci;

-- CreateTable
CREATE TABLE `departments` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(100) NOT NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `sort_order` SMALLINT NOT NULL DEFAULT 0,
    `created_at` DATETIME(0) NULL,
    `updated_at` DATETIME(0) NULL,

    UNIQUE INDEX `departments_name_unique`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci;

-- CreateTable
CREATE TABLE `divisions` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(100) NOT NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `sort_order` SMALLINT NOT NULL DEFAULT 0,
    `created_at` DATETIME(0) NULL,
    `updated_at` DATETIME(0) NULL,

    UNIQUE INDEX `divisions_name_unique`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci;

-- CreateTable
CREATE TABLE `user_signatures` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT NOT NULL,
    `file_ref` VARCHAR(255) NOT NULL,
    `mime_type` VARCHAR(50) NOT NULL DEFAULT 'image/png',
    `size` INTEGER NOT NULL DEFAULT 0,
    `source` VARCHAR(10) NOT NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `is_encrypted` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `created_by` BIGINT NULL,

    INDEX `user_signatures_user_id_is_active_index`(`user_id`, `is_active`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci;

-- AddForeignKey
ALTER TABLE `app_settings` ADD CONSTRAINT `app_settings_updated_by_foreign` FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `announcements` ADD CONSTRAINT `announcements_created_by_foreign` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `approval_routes` ADD CONSTRAINT `approval_routes_branch_id_foreign` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `approval_route_steps` ADD CONSTRAINT `approval_route_steps_approval_route_id_foreign` FOREIGN KEY (`approval_route_id`) REFERENCES `approval_routes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `approval_step_approvers` ADD CONSTRAINT `approval_step_approvers_step_id_foreign` FOREIGN KEY (`approval_route_step_id`) REFERENCES `approval_route_steps`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `approval_step_approvers` ADD CONSTRAINT `approval_step_approvers_user_id_foreign` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `it_ticket_approval_steps` ADD CONSTRAINT `it_ticket_approval_steps_it_ticket_id_foreign` FOREIGN KEY (`it_ticket_id`) REFERENCES `it_tickets`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `it_ticket_approval_steps` ADD CONSTRAINT `it_ticket_approval_steps_acted_by_foreign` FOREIGN KEY (`acted_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `asset_licenses` ADD CONSTRAINT `asset_licenses_asset_id_foreign` FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `license_installations` ADD CONSTRAINT `license_installations_license_asset_id_foreign` FOREIGN KEY (`license_asset_id`) REFERENCES `assets`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `license_installations` ADD CONSTRAINT `license_installations_device_asset_id_foreign` FOREIGN KEY (`device_asset_id`) REFERENCES `assets`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `license_installations` ADD CONSTRAINT `license_installations_user_id_foreign` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `license_installations` ADD CONSTRAINT `license_installations_created_by_foreign` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `license_installations` ADD CONSTRAINT `license_installations_branch_id_foreign` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `asset_files` ADD CONSTRAINT `asset_files_asset_id_foreign` FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `asset_files` ADD CONSTRAINT `asset_files_uploaded_by_foreign` FOREIGN KEY (`uploaded_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `asset_movements` ADD CONSTRAINT `asset_movements_asset_id_foreign` FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `asset_movements` ADD CONSTRAINT `asset_movements_from_custodian_id_foreign` FOREIGN KEY (`from_custodian_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `asset_movements` ADD CONSTRAINT `asset_movements_from_location_id_foreign` FOREIGN KEY (`from_location_id`) REFERENCES `locations`(`id`) ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `asset_movements` ADD CONSTRAINT `asset_movements_performed_by_foreign` FOREIGN KEY (`performed_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `asset_movements` ADD CONSTRAINT `asset_movements_to_custodian_id_foreign` FOREIGN KEY (`to_custodian_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `asset_movements` ADD CONSTRAINT `asset_movements_to_location_id_foreign` FOREIGN KEY (`to_location_id`) REFERENCES `locations`(`id`) ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `assets` ADD CONSTRAINT `assets_created_by_foreign` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `assets` ADD CONSTRAINT `assets_custodian_id_foreign` FOREIGN KEY (`custodian_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `assets` ADD CONSTRAINT `assets_location_id_foreign` FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `assets` ADD CONSTRAINT `assets_updated_by_foreign` FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `contracts` ADD CONSTRAINT `contracts_branch_id_foreign` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `contracts` ADD CONSTRAINT `contracts_created_by_foreign` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `credential_access_logs` ADD CONSTRAINT `credential_access_logs_credential_id_foreign` FOREIGN KEY (`credential_id`) REFERENCES `credentials`(`id`) ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `credential_access_logs` ADD CONSTRAINT `credential_access_logs_user_id_foreign` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `credentials` ADD CONSTRAINT `credentials_branch_id_foreign` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `credentials` ADD CONSTRAINT `credentials_created_by_foreign` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `credentials` ADD CONSTRAINT `credentials_owner_id_foreign` FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `credentials` ADD CONSTRAINT `credentials_updated_by_foreign` FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `it_ticket_attachments` ADD CONSTRAINT `it_ticket_attachments_it_ticket_id_foreign` FOREIGN KEY (`it_ticket_id`) REFERENCES `it_tickets`(`id`) ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `it_ticket_attachments` ADD CONSTRAINT `it_ticket_attachments_uploaded_by_foreign` FOREIGN KEY (`uploaded_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `it_ticket_events` ADD CONSTRAINT `it_ticket_events_it_ticket_id_foreign` FOREIGN KEY (`it_ticket_id`) REFERENCES `it_tickets`(`id`) ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `it_ticket_events` ADD CONSTRAINT `it_ticket_events_user_id_foreign` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `it_ticket_parts` ADD CONSTRAINT `it_ticket_parts_it_ticket_id_foreign` FOREIGN KEY (`it_ticket_id`) REFERENCES `it_tickets`(`id`) ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `it_tickets` ADD CONSTRAINT `it_tickets_approver_id_foreign` FOREIGN KEY (`approver_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `it_tickets` ADD CONSTRAINT `it_tickets_asset_id_foreign` FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `it_tickets` ADD CONSTRAINT `it_tickets_assignee_id_foreign` FOREIGN KEY (`assignee_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `it_tickets` ADD CONSTRAINT `it_tickets_branch_id_foreign` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `it_tickets` ADD CONSTRAINT `it_tickets_it_head_id_foreign` FOREIGN KEY (`it_head_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `it_tickets` ADD CONSTRAINT `it_tickets_requester_id_foreign` FOREIGN KEY (`requester_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `kpi_entries` ADD CONSTRAINT `kpi_entries_user_id_foreign` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `locations` ADD CONSTRAINT `locations_parent_id_foreign` FOREIGN KEY (`parent_id`) REFERENCES `locations`(`id`) ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `users` ADD CONSTRAINT `users_approval_route_id_foreign` FOREIGN KEY (`approval_route_id`) REFERENCES `approval_routes`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `users` ADD CONSTRAINT `users_branch_id_foreign` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `users` ADD CONSTRAINT `users_supervisor_id_foreign` FOREIGN KEY (`supervisor_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `users` ADD CONSTRAINT `users_connection_id_foreign` FOREIGN KEY (`connection_id`) REFERENCES `api_connections`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `api_connections` ADD CONSTRAINT `api_connections_created_by_foreign` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `api_connections` ADD CONSTRAINT `api_connections_updated_by_foreign` FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `external_sessions` ADD CONSTRAINT `external_sessions_token_id_foreign` FOREIGN KEY (`token_id`) REFERENCES `personal_access_tokens`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `external_sessions` ADD CONSTRAINT `external_sessions_user_id_foreign` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `external_sessions` ADD CONSTRAINT `external_sessions_connection_id_foreign` FOREIGN KEY (`connection_id`) REFERENCES `api_connections`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `role_permissions` ADD CONSTRAINT `role_permissions_permission_id_foreign` FOREIGN KEY (`permission_id`) REFERENCES `permissions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_permissions` ADD CONSTRAINT `user_permissions_user_id_foreign` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_permissions` ADD CONSTRAINT `user_permissions_permission_id_foreign` FOREIGN KEY (`permission_id`) REFERENCES `permissions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_permissions` ADD CONSTRAINT `user_permissions_created_by_foreign` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `audit_logs` ADD CONSTRAINT `audit_logs_actor_id_foreign` FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_signatures` ADD CONSTRAINT `user_signatures_user_id_foreign` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_signatures` ADD CONSTRAINT `user_signatures_created_by_foreign` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- ส่วนที่ Prisma ไม่ได้ model ไว้ (เขียนเอง)
-- ---------------------------------------------------------------------------

-- CHECK
ALTER TABLE `users` ADD CONSTRAINT `users_type_check` CHECK (`type` IN ('LOCAL', 'API'));
ALTER TABLE `users` ADD CONSTRAINT `users_local_credentials_check` CHECK (`type` <> 'LOCAL' OR (`email` IS NOT NULL AND `password` IS NOT NULL));
ALTER TABLE `users` ADD CONSTRAINT `users_api_identity_check` CHECK (`type` <> 'API' OR (`connection_id` IS NOT NULL AND `external_id` IS NOT NULL AND `password` IS NULL));
ALTER TABLE `users` ADD CONSTRAINT `users_username_check` CHECK (`username` IS NULL OR `username` NOT LIKE '%@%');
ALTER TABLE `users` ADD CONSTRAINT `users_external_status_check` CHECK (`external_status` IS NULL OR `external_status` IN ('active', 'disabled', 'missing'));
ALTER TABLE `user_permissions` ADD CONSTRAINT `user_permissions_effect_check` CHECK (`effect` IN ('allow', 'deny'));
ALTER TABLE `api_connections` ADD CONSTRAINT `api_connections_auth_type_check` CHECK (`auth_type` IN ('none', 'api_key', 'bearer', 'basic'));
ALTER TABLE `user_signatures` ADD CONSTRAINT `user_signatures_source_check` CHECK (`source` IN ('UPLOAD', 'DRAW'));

-- ชื่อผู้ใช้ห้ามซ้ำแบบไม่สนตัวพิมพ์ (NULL ซ้ำได้)
CREATE UNIQUE INDEX `users_username_lower_unique` ON `users` ((LOWER(`username`)));

-- ลายเซ็นที่ใช้งานอยู่ได้คนละ 1 อัน (แทน partial index ของ PostgreSQL — แถว is_active = false ได้ค่า NULL จึงซ้ำได้)
CREATE UNIQUE INDEX `user_signatures_one_active` ON `user_signatures` ((CASE WHEN `is_active` THEN `user_id` END));
