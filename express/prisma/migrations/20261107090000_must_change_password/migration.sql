-- บังคับเปลี่ยนรหัสผ่านเมื่อเข้าสู่ระบบครั้งแรก (app_settings.password_policy.force_first_change — ผู้ดูแลระบบสูงสุดเปิด/ปิด)
-- ผู้ดูแลสร้างผู้ใช้ / รีเซ็ตรหัสผ่านขณะเปิดนโยบาย = must_change_password true → ผู้ใช้ต้องตั้งรหัสผ่านใหม่ก่อนใช้งาน; ผู้ใช้เดิม = false

-- AlterTable
ALTER TABLE `users` ADD COLUMN `must_change_password` BOOLEAN NOT NULL DEFAULT false;
