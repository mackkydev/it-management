#!/bin/sh
# รันครั้งแรกที่สร้าง volume ของ MySQL เท่านั้น (docker-entrypoint-initdb.d)
# - it_app (MYSQL_USER) เป็นเจ้าของฐาน it_system (MYSQL_DATABASE) อยู่แล้ว
# - เพิ่ม it_system_test (เทสต์ — global-setup ลบ/สร้างใหม่ทุกครั้ง) และ it_system_shadow (prisma migrate dev)
set -eu

mysql --protocol=socket -uroot -p"${MYSQL_ROOT_PASSWORD}" <<-EOSQL
  CREATE DATABASE IF NOT EXISTS it_system_test;
  CREATE DATABASE IF NOT EXISTS it_system_shadow;
  GRANT ALL PRIVILEGES ON \`it_system\`.* TO '${MYSQL_USER}'@'%';
  GRANT ALL PRIVILEGES ON \`it_system_test\`.* TO '${MYSQL_USER}'@'%';
  GRANT ALL PRIVILEGES ON \`it_system_shadow\`.* TO '${MYSQL_USER}'@'%';
  FLUSH PRIVILEGES;
EOSQL
