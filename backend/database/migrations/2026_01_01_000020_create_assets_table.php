<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('assets', function (Blueprint $table) {
            $table->id();
            // ใช้ UUID เป็น public identifier ใน API/QR Code เพื่อไม่ให้เดา id ลำดับได้ (IDOR)
            $table->uuid('uuid')->unique();
            $table->string('asset_tag', 50)->unique();         // เลขครุภัณฑ์ เช่น IT-2026-000123
            $table->string('name');
            $table->string('category', 50);
            $table->string('brand', 100)->nullable();
            $table->string('model', 100)->nullable();
            $table->string('serial_number', 100)->nullable()->index();
            $table->string('status', 20)->default('active');

            $table->foreignId('location_id')->nullable()
                ->constrained('locations')->nullOnDelete();
            $table->foreignId('custodian_id')->nullable()      // ผู้ถือครอง/ผู้รับผิดชอบ
                ->constrained('users')->nullOnDelete();

            $table->date('purchase_date')->nullable();
            $table->decimal('purchase_cost', 15, 2)->nullable();
            $table->date('warranty_expires_at')->nullable();
            $table->text('notes')->nullable();

            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
            $table->softDeletes();

            // Composite index สำหรับรูปแบบการค้นหาที่ใช้บ่อยในข้อมูลปริมาณมาก
            $table->index(['status', 'location_id']);
            $table->index(['category', 'status']);
            $table->index(['deleted_at', 'created_at']);

            // FULLTEXT ใช้ได้บน MariaDB/MySQL เท่านั้น (ข้ามเมื่อรันเทสต์ด้วย SQLite)
            if (in_array(Schema::getConnection()->getDriverName(), ['mariadb', 'mysql'], true)) {
                $table->fullText(['name', 'brand', 'model']);
            }
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('assets');
    }
};
