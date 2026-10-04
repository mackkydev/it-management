-- CreateTable
CREATE TABLE "asset_licenses" (
    "id" BIGSERIAL NOT NULL,
    "asset_id" BIGINT NOT NULL,
    "billing" VARCHAR(20) NOT NULL,
    "start_date" DATE NOT NULL,
    "expires_at" DATE,
    "seats" INTEGER,
    "vendor" VARCHAR(255),
    "license_key" TEXT,
    "notify_days_before" SMALLINT,
    "notified_for_expires_at" DATE,
    "created_at" TIMESTAMP(0),
    "updated_at" TIMESTAMP(0),

    CONSTRAINT "asset_licenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_files" (
    "id" BIGSERIAL NOT NULL,
    "asset_id" BIGINT NOT NULL,
    "kind" VARCHAR(20) NOT NULL DEFAULT 'license',
    "original_name" VARCHAR(255) NOT NULL,
    "path" VARCHAR(255) NOT NULL,
    "mime" VARCHAR(100) NOT NULL,
    "size" INTEGER NOT NULL,
    "uploaded_by" BIGINT,
    "created_at" TIMESTAMP(0),
    "updated_at" TIMESTAMP(0),

    CONSTRAINT "asset_files_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "asset_licenses_asset_id_unique" ON "asset_licenses"("asset_id");

-- CreateIndex
CREATE INDEX "asset_licenses_expires_at_index" ON "asset_licenses"("expires_at");

-- CreateIndex
CREATE INDEX "asset_files_asset_id_index" ON "asset_files"("asset_id");

-- CreateIndex
CREATE INDEX "asset_files_uploaded_by_index" ON "asset_files"("uploaded_by");

-- AddForeignKey
ALTER TABLE "asset_licenses" ADD CONSTRAINT "asset_licenses_asset_id_foreign" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_files" ADD CONSTRAINT "asset_files_asset_id_foreign" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_files" ADD CONSTRAINT "asset_files_uploaded_by_foreign" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE RESTRICT;
