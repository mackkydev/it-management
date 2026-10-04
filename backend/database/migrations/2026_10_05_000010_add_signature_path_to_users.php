<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * สำเนาของ Prisma migration `add_user_signature` สำหรับฐานเทสต์ของ Laravel (SQLite) เท่านั้น
 * ฐานจริงจัดการด้วย Prisma (express/prisma) — มี guard ไว้ ถ้ารันกับฐานจริงจะไม่ทำอะไร
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasColumn('users', 'signature_path')) {
            return;
        }
        Schema::table('users', function (Blueprint $table) {
            $table->string('signature_path')->nullable();
        });
    }

    public function down(): void
    {
        // ไม่ลบคอลัมน์ — ฐานจริงเป็นของ Prisma
    }
};
