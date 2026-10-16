-- คลังบัญชี: สิทธิ์รายรายการ (access_mode + credential_access) — ค่าเดิมทุกแถว = all (ทุกคนที่มีสิทธิ์คลังบัญชีเหมือนเดิม)

-- AlterTable
ALTER TABLE `credentials` ADD COLUMN `access_mode` VARCHAR(20) NOT NULL DEFAULT 'all';

-- CreateTable
CREATE TABLE `credential_access` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `credential_id` BIGINT NOT NULL,
    `user_id` BIGINT NULL,
    `group_key` VARCHAR(50) NULL,
    `created_by` BIGINT NULL,
    `created_at` DATETIME(0) NULL,

    INDEX `credential_access_user_id_index`(`user_id`),
    INDEX `credential_access_group_key_index`(`group_key`),
    INDEX `credential_access_created_by_index`(`created_by`),
    UNIQUE INDEX `credential_access_credential_id_user_id_unique`(`credential_id`, `user_id`),
    UNIQUE INDEX `credential_access_credential_id_group_key_unique`(`credential_id`, `group_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci;

-- AddForeignKey

-- AddForeignKey
ALTER TABLE `credential_access` ADD CONSTRAINT `credential_access_credential_id_foreign` FOREIGN KEY (`credential_id`) REFERENCES `credentials`(`id`) ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `credential_access` ADD CONSTRAINT `credential_access_user_id_foreign` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `credential_access` ADD CONSTRAINT `credential_access_created_by_foreign` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE RESTRICT;

