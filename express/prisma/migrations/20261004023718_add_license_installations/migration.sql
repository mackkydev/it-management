-- CreateTable
CREATE TABLE "license_installations" (
    "id" BIGSERIAL NOT NULL,
    "license_asset_id" BIGINT NOT NULL,
    "device_asset_id" BIGINT,
    "device_name" VARCHAR(255),
    "user_id" BIGINT,
    "branch_id" BIGINT,
    "installed_at" DATE NOT NULL,
    "uninstalled_at" DATE,
    "notes" TEXT,
    "created_by" BIGINT,
    "created_at" TIMESTAMP(0),
    "updated_at" TIMESTAMP(0),

    CONSTRAINT "license_installations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "license_installations_license_active_index" ON "license_installations"("license_asset_id", "uninstalled_at");

-- CreateIndex
CREATE INDEX "license_installations_device_asset_id_index" ON "license_installations"("device_asset_id");

-- CreateIndex
CREATE INDEX "license_installations_user_id_index" ON "license_installations"("user_id");

-- CreateIndex
CREATE INDEX "license_installations_branch_id_index" ON "license_installations"("branch_id");

-- AddForeignKey
ALTER TABLE "license_installations" ADD CONSTRAINT "license_installations_license_asset_id_foreign" FOREIGN KEY ("license_asset_id") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "license_installations" ADD CONSTRAINT "license_installations_device_asset_id_foreign" FOREIGN KEY ("device_asset_id") REFERENCES "assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "license_installations" ADD CONSTRAINT "license_installations_user_id_foreign" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "license_installations" ADD CONSTRAINT "license_installations_created_by_foreign" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "license_installations" ADD CONSTRAINT "license_installations_branch_id_foreign" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
