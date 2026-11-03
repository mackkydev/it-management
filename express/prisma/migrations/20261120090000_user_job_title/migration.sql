-- ตำแหน่งงานของผู้ใช้ (ข้อความ ไม่บังคับ) — แยกจากสิทธิ์กลุ่มใช้งาน users.role
ALTER TABLE `users` ADD COLUMN `job_title` VARCHAR(100) NULL;
