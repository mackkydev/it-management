-- ย้อนกลับ 20261014090000_calendar_leave (รันด้วย mysql client เอง)
DROP TABLE IF EXISTS `leave_files`;
DROP TABLE IF EXISTS `leave_quota_overrides`;
DROP TABLE IF EXISTS `company_holidays`;
DROP TABLE IF EXISTS `calendar_events`;
DROP TABLE IF EXISTS `leave_requests`;
ALTER TABLE `users` DROP INDEX `users_calendar_token_unique`;
ALTER TABLE `users` DROP COLUMN `calendar_token`;
