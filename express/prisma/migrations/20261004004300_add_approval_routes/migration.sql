-- AlterTable
ALTER TABLE "it_tickets" ADD COLUMN     "current_step" SMALLINT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "approval_route_id" BIGINT;

-- CreateTable
CREATE TABLE "approval_routes" (
    "id" BIGSERIAL NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "branch_id" BIGINT,
    "department" VARCHAR(100),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(0),
    "updated_at" TIMESTAMP(0),

    CONSTRAINT "approval_routes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_route_steps" (
    "id" BIGSERIAL NOT NULL,
    "approval_route_id" BIGINT NOT NULL,
    "step_no" SMALLINT NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "created_at" TIMESTAMP(0),
    "updated_at" TIMESTAMP(0),

    CONSTRAINT "approval_route_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_step_approvers" (
    "approval_route_step_id" BIGINT NOT NULL,
    "user_id" BIGINT NOT NULL,

    CONSTRAINT "approval_step_approvers_pkey" PRIMARY KEY ("approval_route_step_id","user_id")
);

-- CreateTable
CREATE TABLE "it_ticket_approval_steps" (
    "id" BIGSERIAL NOT NULL,
    "it_ticket_id" BIGINT NOT NULL,
    "step_no" SMALLINT NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "approver_ids" JSONB NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "acted_by" BIGINT,
    "acted_at" TIMESTAMP(0),
    "comment" TEXT,
    "created_at" TIMESTAMP(0),
    "updated_at" TIMESTAMP(0),

    CONSTRAINT "it_ticket_approval_steps_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "approval_routes_branch_id_is_active_index" ON "approval_routes"("branch_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "approval_route_steps_route_step_unique" ON "approval_route_steps"("approval_route_id", "step_no");

-- CreateIndex
CREATE INDEX "approval_step_approvers_user_id_index" ON "approval_step_approvers"("user_id");

-- CreateIndex
CREATE INDEX "it_ticket_approval_steps_acted_by_index" ON "it_ticket_approval_steps"("acted_by");

-- CreateIndex
CREATE UNIQUE INDEX "it_ticket_approval_steps_ticket_step_unique" ON "it_ticket_approval_steps"("it_ticket_id", "step_no");

-- AddForeignKey
ALTER TABLE "approval_routes" ADD CONSTRAINT "approval_routes_branch_id_foreign" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "approval_route_steps" ADD CONSTRAINT "approval_route_steps_approval_route_id_foreign" FOREIGN KEY ("approval_route_id") REFERENCES "approval_routes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_step_approvers" ADD CONSTRAINT "approval_step_approvers_step_id_foreign" FOREIGN KEY ("approval_route_step_id") REFERENCES "approval_route_steps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_step_approvers" ADD CONSTRAINT "approval_step_approvers_user_id_foreign" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "it_ticket_approval_steps" ADD CONSTRAINT "it_ticket_approval_steps_it_ticket_id_foreign" FOREIGN KEY ("it_ticket_id") REFERENCES "it_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "it_ticket_approval_steps" ADD CONSTRAINT "it_ticket_approval_steps_acted_by_foreign" FOREIGN KEY ("acted_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_approval_route_id_foreign" FOREIGN KEY ("approval_route_id") REFERENCES "approval_routes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
