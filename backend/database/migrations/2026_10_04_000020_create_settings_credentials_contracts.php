<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // ตั้งค่าระบบแบบ key-value (เช่น จำนวนวันแจ้งเตือนล่วงหน้า, อีเมลรับแจ้งเตือน)
        Schema::create('app_settings', function (Blueprint $table) {
            $table->string('key', 100)->primary();
            $table->json('value')->nullable();
            $table->foreignId('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
        });

        // 4.1.1 คลังข้อมูลบัญชีผู้ใช้/รหัสผ่านของระบบต่างๆ — ข้อมูลลับเข้ารหัสระดับแอป (encrypted cast)
        Schema::create('credentials', function (Blueprint $table) {
            $table->id();
            $table->string('title');                          // ชื่อระบบ/บริการ
            $table->string('category', 30)->default('system'); // system|server|network|email|software|cloud|other
            $table->string('url', 500)->nullable();           // URL / host / IP
            $table->string('username')->nullable();
            $table->text('password')->nullable();             // encrypted
            $table->text('secret_notes')->nullable();         // encrypted (เช่น recovery code)
            $table->text('notes')->nullable();                // ข้อมูลทั่วไป (ไม่ลับ)
            $table->foreignId('branch_id')->nullable()->constrained('branches')->nullOnDelete();
            $table->foreignId('owner_id')->nullable()->constrained('users')->nullOnDelete(); // ผู้รับผิดชอบ
            $table->date('expires_at')->nullable();           // วันหมดอายุรหัส/บัญชี (ถ้ามี)
            $table->date('notified_for_expires_at')->nullable(); // กันแจ้งเตือนซ้ำ
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('password_changed_at')->nullable();
            $table->timestamps();
            $table->softDeletes();

            $table->index(['category', 'title']);
        });

        // บันทึกทุกครั้งที่มีการเปิดดู/แก้ไขข้อมูลลับ (append-only)
        Schema::create('credential_access_logs', function (Blueprint $table) {
            $table->id();
            $table->foreignId('credential_id')->constrained('credentials')->cascadeOnDelete();
            $table->foreignId('user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->string('action', 20); // reveal|create|update|delete
            $table->string('ip', 45)->nullable();
            $table->timestamp('created_at')->useCurrent();

            $table->index(['credential_id', 'created_at']);
        });

        // 4.1.2 สัญญากับ vendor + แจ้งเตือนล่วงหน้าก่อนหมดอายุ
        Schema::create('contracts', function (Blueprint $table) {
            $table->id();
            $table->string('title');
            $table->string('vendor_name');
            $table->string('contract_no', 100)->nullable();
            $table->date('start_date');
            $table->date('end_date');
            $table->decimal('amount', 15, 2)->nullable();
            $table->string('contact_name')->nullable();
            $table->string('contact_email')->nullable();
            $table->string('contact_phone', 50)->nullable();
            // null = ใช้ค่าเริ่มต้นจากหน้าตั้งค่า
            $table->unsignedSmallInteger('notify_days_before')->nullable();
            $table->boolean('notify_enabled')->default(true);
            // กันส่งซ้ำ: จำวันหมดอายุที่แจ้งไปแล้ว (ต่ออายุ = end_date เปลี่ยน → แจ้งใหม่ได้)
            $table->date('notified_for_end_date')->nullable();
            $table->timestamp('notified_at')->nullable();
            $table->text('notes')->nullable();
            $table->foreignId('branch_id')->nullable()->constrained('branches')->nullOnDelete();
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
            $table->softDeletes();

            $table->index(['end_date', 'notify_enabled']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('contracts');
        Schema::dropIfExists('credential_access_logs');
        Schema::dropIfExists('credentials');
        Schema::dropIfExists('app_settings');
    }
};
