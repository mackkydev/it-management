-- CreateTable
CREATE TABLE "departments" (
    "id" BIGSERIAL NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" SMALLINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(0),
    "updated_at" TIMESTAMP(0),

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "divisions" (
    "id" BIGSERIAL NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" SMALLINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(0),
    "updated_at" TIMESTAMP(0),

    CONSTRAINT "divisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "departments_name_unique" ON "departments"("name");

-- CreateIndex
CREATE UNIQUE INDEX "divisions_name_unique" ON "divisions"("name");


-- ข้อมูลตั้งต้น: ชื่อแผนก/ฝ่ายที่ใช้อยู่แล้วในผู้ใช้ (และสายอนุมัติ) — ไม่แก้ข้อมูลเดิม แค่สร้างรายการให้เลือก
INSERT INTO "departments" ("name", "created_at", "updated_at")
SELECT DISTINCT ON (LOWER(TRIM(v))) TRIM(v), NOW(), NOW()
FROM (SELECT "department" AS v FROM "users" UNION ALL SELECT "department" FROM "approval_routes") s
WHERE v IS NOT NULL AND TRIM(v) <> ''
ORDER BY LOWER(TRIM(v)), TRIM(v)
ON CONFLICT ("name") DO NOTHING;

INSERT INTO "divisions" ("name", "created_at", "updated_at")
SELECT DISTINCT ON (LOWER(TRIM("division"))) TRIM("division"), NOW(), NOW()
FROM "users"
WHERE "division" IS NOT NULL AND TRIM("division") <> ''
ORDER BY LOWER(TRIM("division")), TRIM("division")
ON CONFLICT ("name") DO NOTHING;
