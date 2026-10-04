<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * ประวัติการโอนย้ายสินทรัพย์ (สถานที่ / ผู้ถือครอง) — เป็น audit log: เพิ่มได้อย่างเดียว ไม่มีการแก้ไข/ลบผ่าน API
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('asset_movements', function (Blueprint $table) {
            $table->id();
            $table->foreignId('asset_id')->constrained('assets')->cascadeOnDelete();
            $table->string('type', 20);                        // registered | transfer

            $table->foreignId('from_location_id')->nullable()->constrained('locations')->nullOnDelete();
            $table->foreignId('to_location_id')->nullable()->constrained('locations')->nullOnDelete();
            $table->foreignId('from_custodian_id')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('to_custodian_id')->nullable()->constrained('users')->nullOnDelete();

            $table->dateTime('moved_at');                      // วันเวลาที่โอนย้ายจริง (อาจย้อนหลังได้)
            $table->text('reason')->nullable();
            $table->foreignId('performed_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('created_at')->useCurrent();     // เวลาที่บันทึกเข้าระบบ

            // ดึงประวัติของสินทรัพย์เรียงตามเวลา / รายงานการเข้า-ออกของสถานที่
            $table->index(['asset_id', 'moved_at']);
            $table->index(['to_location_id', 'moved_at']);
            $table->index(['to_custodian_id', 'moved_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('asset_movements');
    }
};
