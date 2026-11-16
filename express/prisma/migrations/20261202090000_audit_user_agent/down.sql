-- ย้อนกลับ 20261202090000_audit_user_agent (รันด้วยมือ แล้วลบแถวใน _prisma_migrations)
ALTER TABLE `audit_logs` DROP COLUMN `user_agent`;
