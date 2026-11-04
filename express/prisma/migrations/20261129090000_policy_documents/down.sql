-- ย้อนกลับ 20261129090000_policy_documents (รันด้วยมือ แล้วลบแถวใน _prisma_migrations) — ไฟล์ใน storage/private/policy ต้องลบแยก
DROP TABLE `policy_files`;
DROP TABLE `policy_versions`;
ALTER TABLE `policy_acceptances` DROP COLUMN `name_stamp`, DROP COLUMN `signature_path`, DROP COLUMN `signature_at`;
