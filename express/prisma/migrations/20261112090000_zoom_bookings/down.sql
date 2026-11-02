-- ย้อนกลับ 20261112090000_zoom_bookings (รันด้วย mysql client เอง แล้วลบแถวใน _prisma_migrations) — ใบแจ้งงานที่สร้างจากการจอง ZOOM คงไว้
DROP TABLE IF EXISTS `zoom_bookings`;
-- สิทธิ์ zoom.manage (สร้างโดย ensurePermissions — role_permissions / user_permissions ลบตาม FK cascade)
DELETE FROM `permissions` WHERE `key` = 'zoom.manage';
