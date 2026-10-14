#!/usr/bin/env bash
# สำรองข้อมูล IT-SYSTEM แบบเข้ารหัส (เครื่องจริง Linux) — ฐานข้อมูล + ไฟล์แนบ/ลายเซ็น/license + ไฟล์ .env (มี APP_KEY)
#
#   1) cp deploy/backup.env.example deploy/backup.env แล้วแก้ค่า (chmod 600)
#   2) สร้างไฟล์รหัสผ่านสำหรับเข้ารหัส: openssl rand -base64 48 > /root/.it-system-backup-pass && chmod 600 /root/.it-system-backup-pass
#      ** เก็บสำเนารหัสนี้ไว้นอกเครื่อง (เช่น ตู้เซฟ / password manager ของบริษัท) — หายแล้วถอดไฟล์สำรองไม่ได้ **
#   3) ทดสอบ: bash deploy/backup.sh  → ได้ไฟล์ it-system-YYYYmmdd-HHMM.tar.gz.enc + .sha256
#   4) ตั้งเวลา (crontab -e): 30 2 * * * /usr/bin/bash /opt/it-management/deploy/backup.sh >> /var/log/it-system-backup.log 2>&1
#
# ข้อมูลในไฟล์สำรองไม่ออกนอกเครื่องแบบไม่เข้ารหัส: dump → tar → openssl AES-256 (PBKDF2) ในท่อเดียว ไม่เขียนไฟล์ dump ดิบลงดิสก์
# วิธีกู้คืน: deploy/README.md หัวข้อ "กู้คืนข้อมูล"
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "${HERE}/backup.env"

: "${PROJECT_DIR:?ตั้ง PROJECT_DIR ใน backup.env}"
: "${BACKUP_DIR:?ตั้ง BACKUP_DIR ใน backup.env}"
: "${PASSPHRASE_FILE:?ตั้ง PASSPHRASE_FILE ใน backup.env}"
KEEP_DAYS="${KEEP_DAYS:-30}"
MYSQL_CONTAINER="${MYSQL_CONTAINER:-it_mysql}"

[ -r "${PASSPHRASE_FILE}" ] || { echo "อ่านไฟล์รหัสผ่าน ${PASSPHRASE_FILE} ไม่ได้" >&2; exit 1; }
mkdir -p "${BACKUP_DIR}"
chmod 700 "${BACKUP_DIR}"
umask 077

STAMP="$(date +%Y%m%d-%H%M)"
WORK="$(mktemp -d)"
trap 'rm -rf "${WORK}"' EXIT
OUT="${BACKUP_DIR}/it-system-${STAMP}.tar.gz.enc"

echo "[$(date -Is)] เริ่มสำรองข้อมูล → ${OUT}"

# 1) dump ฐานข้อมูล (ใช้ root ใน container — รหัสอยู่ใน env ของ container ไม่ผ่าน command line ของเครื่อง)
docker exec "${MYSQL_CONTAINER}" sh -c 'exec mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" --single-transaction --routines --triggers --hex-blob it_system' \
  2>/dev/null | gzip > "${WORK}/it_system.sql.gz"
[ -s "${WORK}/it_system.sql.gz" ] || { echo "mysqldump ไม่ได้ข้อมูล" >&2; exit 1; }

# 2) รวมไฟล์ส่วนตัว + .env (APP_KEY ต้องตรงกับข้อมูลที่เข้ารหัสไว้) แล้วเข้ารหัสทันที
FILES=(storage/private)
for f in express/.env .env; do [ -f "${PROJECT_DIR}/${f}" ] && FILES+=("${f}"); done
tar -C "${PROJECT_DIR}" -czf - \
  "${FILES[@]}" \
  -C "${WORK}" it_system.sql.gz \
  | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass "file:${PASSPHRASE_FILE}" -out "${OUT}"

sha256sum "${OUT}" > "${OUT}.sha256"
echo "[$(date -Is)] เสร็จ: $(du -h "${OUT}" | cut -f1)"

# 3) ส่งสำเนาออกนอกเครื่อง (ไม่บังคับ) — ไฟล์เข้ารหัสแล้ว ส่งไป cloud ได้ เช่น rclone remote ชื่อ offsite:
if [ -n "${RCLONE_REMOTE:-}" ]; then
  rclone copy "${OUT}" "${RCLONE_REMOTE}" && rclone copy "${OUT}.sha256" "${RCLONE_REMOTE}"
  echo "[$(date -Is)] ส่งสำเนาไป ${RCLONE_REMOTE} แล้ว"
fi

# 4) ลบไฟล์สำรองในเครื่องที่เก่ากว่า KEEP_DAYS วัน
find "${BACKUP_DIR}" -name 'it-system-*.tar.gz.enc*' -type f -mtime "+${KEEP_DAYS}" -print -delete
