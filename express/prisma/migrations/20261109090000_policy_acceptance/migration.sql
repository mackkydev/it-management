-- 1) บังคับเปลี่ยนรหัสผ่านครั้งแรก (password_policy.force_first_change) ใช้กับผู้ใช้ทุกคนที่ยังไม่เคยตั้งรหัสผ่านเอง
--    password_self_changed_at = ผู้ใช้ตั้งรหัสผ่านเองล่าสุด (เปลี่ยนรหัสผ่านที่โปรไฟล์ / หน้าบังคับเปลี่ยน) — NULL = รหัสผ่านที่ผู้ดูแลตั้งให้ / ผู้ใช้เดิม
ALTER TABLE `users` ADD COLUMN `password_self_changed_at` DATETIME(0) NULL;

-- 2) การยอมรับนโยบายของระบบ (app_settings.system_policy) — 1 แถวต่อผู้ใช้ต่อเวอร์ชันของนโยบาย (ประวัติ ห้ามแก้/ลบผ่าน API)
CREATE TABLE `policy_acceptances` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT NOT NULL,
    `version` INTEGER NOT NULL,
    `accepted_at` DATETIME(0) NOT NULL,
    `ip` VARCHAR(45) NULL,
    `user_agent` VARCHAR(255) NULL,

    UNIQUE INDEX `policy_acceptances_user_version_unique`(`user_id`, `version`),
    INDEX `policy_acceptances_version_index`(`version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci;

ALTER TABLE `policy_acceptances` ADD CONSTRAINT `policy_acceptances_user_id_foreign` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE RESTRICT;
