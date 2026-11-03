-- ย้อนกลับ 20261118090000_asset_branch_moves_license_cancel (รันด้วยมือ แล้วลบแถวใน _prisma_migrations) — สาขาในประวัติโอนย้ายและการยกเลิกสัญญา License หายไป
ALTER TABLE `asset_licenses` DROP FOREIGN KEY `asset_licenses_cancelled_by_foreign`;
ALTER TABLE `asset_licenses` DROP COLUMN `cancelled_at`, DROP COLUMN `cancelled_by`, DROP COLUMN `cancel_reason`;
ALTER TABLE `asset_movements` DROP FOREIGN KEY `asset_movements_from_branch_id_foreign`;
ALTER TABLE `asset_movements` DROP FOREIGN KEY `asset_movements_to_branch_id_foreign`;
ALTER TABLE `asset_movements` DROP COLUMN `from_branch_id`, DROP COLUMN `to_branch_id`;
