-- ย้อนกลับ 20261008120000_token_reauth (รันด้วย mysql client เอง)
ALTER TABLE `personal_access_tokens` DROP COLUMN `reauth_at`;
