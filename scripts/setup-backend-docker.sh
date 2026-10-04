#!/usr/bin/env sh
# รันจากโฟลเดอร์รากของโปรเจกต์:
#   docker compose run --rm -v ./scripts:/scripts api sh /scripts/setup-backend-docker.sh
# สร้าง Laravel skeleton แล้วคัดลอกเฉพาะไฟล์ที่ยังไม่มีใน backend/ (ไม่เขียนทับไฟล์ของโปรเจกต์)
set -e

APP=/var/www/html
SKEL=/tmp/laravel_skeleton

if [ -f "$APP/artisan" ]; then
  echo "backend/ ถูกติดตั้งแล้ว (พบ artisan) — ข้ามการสร้าง skeleton"
else
  rm -rf "$SKEL"
  # ใช้ sqlite ชั่วคราวใน skeleton เพื่อไม่ให้ post-install script ไป migrate เข้า MariaDB
  export DB_CONNECTION=sqlite DB_DATABASE=/tmp/skeleton.sqlite
  touch /tmp/skeleton.sqlite
  composer create-project laravel/laravel "$SKEL" --prefer-dist --no-interaction
  cd "$SKEL"
  php artisan install:api --without-migration-prompt --no-interaction
  unset DB_CONNECTION DB_DATABASE
  rm -f "$SKEL/.env" "$SKEL/.env.example" "$SKEL/database/database.sqlite"
  cp -rn "$SKEL"/. "$APP"/
  rm -f "$APP/database/database.sqlite"
fi

cd "$APP"
if [ ! -f .env ]; then
  cp .env.example .env
  sed -i 's/^DB_HOST=.*/DB_HOST=mariadb/' .env   # ชื่อ service ใน docker-compose
fi
grep -q '^APP_KEY=base64' .env || php artisan key:generate --no-interaction
echo "เสร็จแล้ว"
