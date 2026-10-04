-- CreateTable
CREATE TABLE "kpi_entries" (
    "id" BIGSERIAL NOT NULL,
    "user_id" BIGINT NOT NULL,
    "work_date" DATE NOT NULL,
    "details" TEXT NOT NULL,
    "created_at" TIMESTAMP(0),
    "updated_at" TIMESTAMP(0),

    CONSTRAINT "kpi_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "kpi_entries_user_id_work_date_index" ON "kpi_entries"("user_id", "work_date");

-- CreateIndex
CREATE INDEX "kpi_entries_work_date_index" ON "kpi_entries"("work_date");

-- AddForeignKey
ALTER TABLE "kpi_entries" ADD CONSTRAINT "kpi_entries_user_id_foreign" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
