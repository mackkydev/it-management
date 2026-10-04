<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * สำเนาของ Prisma migration `add_kpi_entries` สำหรับฐานเทสต์ของ Laravel (SQLite) เท่านั้น
 * ฐานจริงจัดการด้วย Prisma (express/prisma) — มี guard ไว้ ถ้ารันกับฐานจริงจะไม่ทำอะไร
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('kpi_entries')) {
            return;
        }
        Schema::create('kpi_entries', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained('users')->cascadeOnDelete();
            $table->date('work_date');
            $table->text('details');
            $table->timestamps();

            $table->index(['user_id', 'work_date']);
            $table->index('work_date');
        });
    }

    public function down(): void
    {
        // ไม่ลบตาราง — ฐานจริงเป็นของ Prisma
    }
};
