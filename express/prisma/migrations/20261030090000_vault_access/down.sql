-- ย้อนกลับ 20261030090000_vault_access (รันด้วย mysql client เอง) — รายการที่จำกัดสิทธิ์ไว้จะกลับเป็นทุกคนที่มีสิทธิ์คลังบัญชีเห็นได้
DROP TABLE `credential_access`;
ALTER TABLE `credentials` DROP COLUMN `access_mode`;
