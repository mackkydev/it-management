-- CreateTable
CREATE TABLE "user_signatures" (
    "id" BIGSERIAL NOT NULL,
    "user_id" BIGINT NOT NULL,
    "file_ref" VARCHAR(255) NOT NULL,
    "mime_type" VARCHAR(50) NOT NULL DEFAULT 'image/png',
    "size" INTEGER NOT NULL DEFAULT 0,
    "source" VARCHAR(10) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_encrypted" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT,

    CONSTRAINT "user_signatures_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_signatures_user_id_is_active_index" ON "user_signatures"("user_id", "is_active");

-- AddForeignKey
ALTER TABLE "user_signatures" ADD CONSTRAINT "user_signatures_user_id_foreign" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_signatures" ADD CONSTRAINT "user_signatures_created_by_foreign" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- กติกาที่ Prisma ไม่ได้ model ไว้
ALTER TABLE "user_signatures" ADD CONSTRAINT "user_signatures_source_check" CHECK ("source" IN ('UPLOAD', 'DRAW'));
-- ผู้ใช้ 1 คนมีลายเซ็นที่ใช้งานได้ไม่เกิน 1 รายการ
CREATE UNIQUE INDEX "user_signatures_one_active" ON "user_signatures"("user_id") WHERE "is_active";

-- ลายเซ็นเดิมในโปรไฟล์ (users.signature_path) → รายการแรกของประวัติ (ไฟล์เดิมไม่ได้เข้ารหัส) — users.signature_path คงไว้ไม่แตะ
INSERT INTO "user_signatures" ("user_id", "file_ref", "mime_type", "size", "source", "is_active", "is_encrypted", "created_at", "created_by")
SELECT "id", "signature_path",
       CASE WHEN LOWER("signature_path") LIKE '%.jpg' OR LOWER("signature_path") LIKE '%.jpeg' THEN 'image/jpeg'
            WHEN LOWER("signature_path") LIKE '%.webp' THEN 'image/webp' ELSE 'image/png' END,
       0, 'UPLOAD', true, false, COALESCE("updated_at", NOW()), "id"
FROM "users" WHERE "signature_path" IS NOT NULL AND "signature_path" <> '';
