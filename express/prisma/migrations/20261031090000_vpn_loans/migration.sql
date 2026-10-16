-- ยืม VPN: บัญชี VPN จากคลังบัญชี/รหัสผ่าน (หมวด VPN) + วันหมดอายุ / แจ้งเตือนล่วงหน้า / ต่ออายุ-ยกเลิกผ่านใบแจ้งงาน — routes/vpn-loans.ts
-- CreateTable
CREATE TABLE `vpn_loans` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `uuid` CHAR(36) NOT NULL,
    `user_id` BIGINT NOT NULL,
    `department` VARCHAR(255) NULL,
    `purpose` TEXT NOT NULL,
    `requested_until` DATE NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'requested',
    `credential_id` BIGINT NULL,
    `assigned_by` BIGINT NULL,
    `assigned_at` DATETIME(0) NULL,
    `start_on` DATE NULL,
    `expires_on` DATE NULL,
    `notify_days_before` SMALLINT NOT NULL DEFAULT 7,
    `reminded_for` DATE NULL,
    `expired_notified_for` DATE NULL,
    `renew_until` DATE NULL,
    `choice_reason` TEXT NULL,
    `choice_at` DATETIME(0) NULL,
    `ticket_id` BIGINT NULL,
    `ended_at` DATETIME(0) NULL,
    `ended_by` BIGINT NULL,
    `end_note` TEXT NULL,
    `created_at` DATETIME(0) NULL,
    `updated_at` DATETIME(0) NULL,

    UNIQUE INDEX `vpn_loans_uuid_unique`(`uuid`),
    INDEX `vpn_loans_user_id_index`(`user_id`),
    INDEX `vpn_loans_status_expires_on_index`(`status`, `expires_on`),
    INDEX `vpn_loans_credential_id_index`(`credential_id`),
    INDEX `vpn_loans_ticket_id_index`(`ticket_id`),
    INDEX `vpn_loans_assigned_by_index`(`assigned_by`),
    INDEX `vpn_loans_ended_by_index`(`ended_by`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci;


-- AddForeignKey
ALTER TABLE `vpn_loans` ADD CONSTRAINT `vpn_loans_user_id_foreign` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `vpn_loans` ADD CONSTRAINT `vpn_loans_credential_id_foreign` FOREIGN KEY (`credential_id`) REFERENCES `credentials`(`id`) ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `vpn_loans` ADD CONSTRAINT `vpn_loans_assigned_by_foreign` FOREIGN KEY (`assigned_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `vpn_loans` ADD CONSTRAINT `vpn_loans_ended_by_foreign` FOREIGN KEY (`ended_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `vpn_loans` ADD CONSTRAINT `vpn_loans_ticket_id_foreign` FOREIGN KEY (`ticket_id`) REFERENCES `it_tickets`(`id`) ON DELETE SET NULL ON UPDATE RESTRICT;

