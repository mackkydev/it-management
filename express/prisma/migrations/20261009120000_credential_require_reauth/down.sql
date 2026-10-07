-- ย้อนกลับ 20261009120000_credential_require_reauth (รันด้วย mysql client เอง)
ALTER TABLE `credentials` DROP COLUMN `require_reauth`;
