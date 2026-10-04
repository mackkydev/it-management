-- AlterTable
ALTER TABLE "users" ADD COLUMN     "connection_id" BIGINT,
ADD COLUMN     "external_id" VARCHAR(191),
ADD COLUMN     "external_synced_at" TIMESTAMP(0),
ADD COLUMN     "type" VARCHAR(10) NOT NULL DEFAULT 'LOCAL',
ALTER COLUMN "email" DROP NOT NULL,
ALTER COLUMN "password" DROP NOT NULL;

-- CreateTable
CREATE TABLE "api_connections" (
    "id" BIGSERIAL NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "is_enabled" BOOLEAN NOT NULL DEFAULT false,
    "base_url" VARCHAR(500) NOT NULL,
    "timeout_ms" INTEGER NOT NULL DEFAULT 10000,
    "login_method" VARCHAR(10) NOT NULL DEFAULT 'POST',
    "login_path" VARCHAR(255) NOT NULL,
    "login_username_field" VARCHAR(100) NOT NULL DEFAULT 'username',
    "login_password_field" VARCHAR(100) NOT NULL DEFAULT 'password',
    "login_body_type" VARCHAR(10) NOT NULL DEFAULT 'json',
    "profile_method" VARCHAR(10) NOT NULL DEFAULT 'GET',
    "profile_path" VARCHAR(255),
    "profile_root_path" VARCHAR(255),
    "logout_path" VARCHAR(255),
    "refresh_path" VARCHAR(255),
    "token_path" VARCHAR(255) NOT NULL DEFAULT 'token',
    "token_ttl_path" VARCHAR(255),
    "refresh_token_path" VARCHAR(255),
    "default_token_ttl_seconds" INTEGER NOT NULL DEFAULT 86400,
    "profile_cache_seconds" INTEGER NOT NULL DEFAULT 600,
    "field_map" JSONB NOT NULL DEFAULT '{}',
    "role_rules" JSONB NOT NULL DEFAULT '[]',
    "default_role" VARCHAR(20) NOT NULL DEFAULT 'viewer',
    "error_code_path" VARCHAR(255),
    "error_messages" JSONB NOT NULL DEFAULT '{}',
    "auth_type" VARCHAR(20) NOT NULL DEFAULT 'none',
    "auth_header_name" VARCHAR(100),
    "auth_username" VARCHAR(255),
    "auth_secret" TEXT,
    "allowed_hosts" JSONB NOT NULL DEFAULT '[]',
    "max_redirects" SMALLINT NOT NULL DEFAULT 0,
    "register_url" VARCHAR(500),
    "forgot_password_url" VARCHAR(500),
    "change_password_url" VARCHAR(500),
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "created_at" TIMESTAMP(0),
    "updated_at" TIMESTAMP(0),

    CONSTRAINT "api_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_sessions" (
    "id" BIGSERIAL NOT NULL,
    "token_id" BIGINT NOT NULL,
    "user_id" BIGINT NOT NULL,
    "connection_id" BIGINT NOT NULL,
    "access_token" TEXT NOT NULL,
    "refresh_token" TEXT,
    "expires_at" TIMESTAMP(0) NOT NULL,
    "profile_checked_at" TIMESTAMP(0),
    "created_at" TIMESTAMP(0),
    "updated_at" TIMESTAMP(0),

    CONSTRAINT "external_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" BIGSERIAL NOT NULL,
    "key" VARCHAR(100) NOT NULL,
    "group" VARCHAR(50) NOT NULL,
    "name_th" VARCHAR(200) NOT NULL,
    "name_en" VARCHAR(200) NOT NULL,
    "sort_order" SMALLINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(0),
    "updated_at" TIMESTAMP(0),

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "role" VARCHAR(20) NOT NULL,
    "permission_id" BIGINT NOT NULL,
    "created_at" TIMESTAMP(0),

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role","permission_id")
);

-- CreateTable
CREATE TABLE "user_permissions" (
    "user_id" BIGINT NOT NULL,
    "permission_id" BIGINT NOT NULL,
    "effect" VARCHAR(10) NOT NULL,
    "created_by" BIGINT,
    "created_at" TIMESTAMP(0),

    CONSTRAINT "user_permissions_pkey" PRIMARY KEY ("user_id","permission_id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" BIGSERIAL NOT NULL,
    "actor_id" BIGINT,
    "action" VARCHAR(100) NOT NULL,
    "subject_type" VARCHAR(50) NOT NULL,
    "subject_id" VARCHAR(64),
    "before" JSONB,
    "after" JSONB,
    "ip" VARCHAR(45),
    "created_at" TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "external_sessions_token_id_unique" ON "external_sessions"("token_id");

-- CreateIndex
CREATE INDEX "external_sessions_user_id_index" ON "external_sessions"("user_id");

-- CreateIndex
CREATE INDEX "external_sessions_expires_at_index" ON "external_sessions"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_key_unique" ON "permissions"("key");

-- CreateIndex
CREATE INDEX "audit_logs_subject_index" ON "audit_logs"("subject_type", "subject_id");

-- CreateIndex
CREATE INDEX "audit_logs_actor_id_index" ON "audit_logs"("actor_id");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_index" ON "audit_logs"("created_at");

-- CreateIndex
CREATE INDEX "users_type_index" ON "users"("type");

-- CreateIndex
CREATE UNIQUE INDEX "users_connection_id_external_id_unique" ON "users"("connection_id", "external_id");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_connection_id_foreign" FOREIGN KEY ("connection_id") REFERENCES "api_connections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_connections" ADD CONSTRAINT "api_connections_created_by_foreign" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_connections" ADD CONSTRAINT "api_connections_updated_by_foreign" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_sessions" ADD CONSTRAINT "external_sessions_token_id_foreign" FOREIGN KEY ("token_id") REFERENCES "personal_access_tokens"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_sessions" ADD CONSTRAINT "external_sessions_user_id_foreign" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_sessions" ADD CONSTRAINT "external_sessions_connection_id_foreign" FOREIGN KEY ("connection_id") REFERENCES "api_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_foreign" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_permissions" ADD CONSTRAINT "user_permissions_user_id_foreign" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_permissions" ADD CONSTRAINT "user_permissions_permission_id_foreign" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_permissions" ADD CONSTRAINT "user_permissions_created_by_foreign" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_foreign" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- CHECK (Prisma ไม่ได้ model ไว้ — เขียนเอง)
-- ผู้ใช้เดิมทั้งหมดได้ type = LOCAL จาก DEFAULT และยังต้องมีอีเมล + รหัสผ่านเหมือนเดิม
-- API User ต้องมี connection_id + external_id และห้ามเก็บรหัสผ่าน
ALTER TABLE "users" ADD CONSTRAINT "users_type_check" CHECK ("type" IN ('LOCAL', 'API'));
ALTER TABLE "users" ADD CONSTRAINT "users_local_credentials_check" CHECK ("type" <> 'LOCAL' OR ("email" IS NOT NULL AND "password" IS NOT NULL));
ALTER TABLE "users" ADD CONSTRAINT "users_api_identity_check" CHECK ("type" <> 'API' OR ("connection_id" IS NOT NULL AND "external_id" IS NOT NULL AND "password" IS NULL));
ALTER TABLE "user_permissions" ADD CONSTRAINT "user_permissions_effect_check" CHECK ("effect" IN ('allow', 'deny'));
ALTER TABLE "api_connections" ADD CONSTRAINT "api_connections_auth_type_check" CHECK ("auth_type" IN ('none', 'api_key', 'bearer', 'basic'));
