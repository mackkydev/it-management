-- ขอใช้ VPN ผ่านใบแจ้งงาน: วันเริ่มต้นที่ผู้ขอต้องการ (คู่กับ requested_until)
ALTER TABLE `vpn_loans` ADD COLUMN `requested_from` DATE NULL AFTER `purpose`;
