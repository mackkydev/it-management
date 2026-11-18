-- ฟังก์ชัน/operator ให้ SQL ชุดเดียวกับ MySQL ทำงานบน PostgreSQL ได้ (ใช้คู่กับตัวแปลงใน src/db-postgres.ts)
-- เฉพาะสิ่งที่แปลงด้วยข้อความไม่ได้ — ที่เหลือ (INSERT IGNORE, ON DUPLICATE KEY, INTERVAL n DAY, ->>'$.x', CAST AS CHAR ฯลฯ) แปลงตอนส่ง query

-- a <=> b (เท่ากันแบบนับ NULL = NULL)
CREATE FUNCTION eam_null_safe_eq(anycompatible, anycompatible) RETURNS boolean
LANGUAGE sql IMMUTABLE AS 'SELECT $1 IS NOT DISTINCT FROM $2';
CREATE OPERATOR <=> (FUNCTION = eam_null_safe_eq, LEFTARG = anycompatible, RIGHTARG = anycompatible, COMMUTATOR = <=>);

-- MySQL เทียบข้อความกับตัวเลขได้ (เช่น audit_logs.subject_id = 5) — PostgreSQL ต้องมี operator ให้
CREATE FUNCTION eam_citext_eq_num(citext, numeric) RETURNS boolean
LANGUAGE sql IMMUTABLE AS 'SELECT $1 = $2::text::citext';
CREATE FUNCTION eam_num_eq_citext(numeric, citext) RETURNS boolean
LANGUAGE sql IMMUTABLE AS 'SELECT $1::text::citext = $2';
CREATE FUNCTION eam_citext_ne_num(citext, numeric) RETURNS boolean
LANGUAGE sql IMMUTABLE AS 'SELECT $1 <> $2::text::citext';
CREATE OPERATOR = (FUNCTION = eam_citext_eq_num, LEFTARG = citext, RIGHTARG = numeric, COMMUTATOR = =, NEGATOR = <>);
CREATE OPERATOR = (FUNCTION = eam_num_eq_citext, LEFTARG = numeric, RIGHTARG = citext, COMMUTATOR = =);
CREATE OPERATOR <> (FUNCTION = eam_citext_ne_num, LEFTARG = citext, RIGHTARG = numeric, NEGATOR = =);

-- FIELD(x, a, b, ...) = ลำดับของ x ในรายการ (ไม่พบ = 0)
CREATE FUNCTION field(anycompatible, VARIADIC anycompatiblearray) RETURNS integer
LANGUAGE sql IMMUTABLE AS 'SELECT COALESCE(array_position($2, $1), 0)';

-- CONVERT_TZ(เวลา, '+07:00', '+00:00') — รับเฉพาะ offset แบบ ±HH:MM (โค้ดไม่ใช้ชื่อ timezone)
CREATE FUNCTION convert_tz(timestamp, text, text) RETURNS timestamp
LANGUAGE sql IMMUTABLE AS 'SELECT $1 - $2::interval + $3::interval';

-- DATE_ADD / DATE_SUB (ตัวแปลงเปลี่ยนชื่อเป็น eam_date_add / eam_date_sub — PostgreSQL 16+ มี date_add(timestamptz, …) อยู่แล้ว)
CREATE FUNCTION eam_date_add(timestamp, interval) RETURNS timestamp
LANGUAGE sql IMMUTABLE AS 'SELECT $1 + $2';
CREATE FUNCTION eam_date_sub(timestamp, interval) RETURNS timestamp
LANGUAGE sql IMMUTABLE AS 'SELECT $1 - $2';

-- SUBSTRING_INDEX(ข้อความ, ตัวคั่น, n) — n บวก = n ส่วนแรก / n ลบ = n ส่วนท้าย (split_part ของ citext ไม่รองรับเลขลบ)
CREATE FUNCTION eam_substring_index(text, text, integer) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN $3 >= 0 THEN array_to_string((string_to_array($1, $2))[1:$3], $2)
    ELSE array_to_string((string_to_array($1, $2))[GREATEST(array_length(string_to_array($1, $2), 1) + $3 + 1, 1):], $2)
  END
$$;

-- YEAR(วันที่) / CURDATE()
CREATE FUNCTION year(timestamp) RETURNS integer
LANGUAGE sql IMMUTABLE AS 'SELECT EXTRACT(YEAR FROM $1)::integer';
CREATE FUNCTION curdate() RETURNS date
LANGUAGE sql STABLE AS 'SELECT CURRENT_DATE';
