-- ย้อนกลับ 20261109090000_policy_acceptance (รันด้วยมือ แล้วลบแถวใน _prisma_migrations) — ประวัติการยอมรับนโยบายจะหาย (สำรองก่อน)
DROP TABLE `policy_acceptances`;
ALTER TABLE `users` DROP COLUMN `password_self_changed_at`;
