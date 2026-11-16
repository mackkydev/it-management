-- ย้อนกลับ: รายการที่รออนุมัติ (pending_approval) กลับเป็นคำขอ (requested) ไม่งั้นสถานะไม่รู้จักในโค้ดเดิม
UPDATE `vpn_loans` SET `status` = 'requested', `credential_id` = NULL WHERE `status` = 'pending_approval';
ALTER TABLE `vpn_loans`
    DROP COLUMN `approved_by`,
    DROP COLUMN `approved_at`,
    DROP COLUMN `received_at`,
    DROP COLUMN `revoked_at`,
    DROP COLUMN `revoked_by`,
    DROP COLUMN `expired_notified_on`;
DELETE FROM `_prisma_migrations` WHERE `migration_name` = '20261214090000_vpn_approval_revoke';
