<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * 4.2 / 4.3 ใบแจ้งดำเนินงาน IT (ตามแบบฟอร์ม "ใบแจ้งดำเนินงาน IT")
 *
 * ลำดับสถานะ:
 *   pending_supervisor → (หัวหน้าอนุมัติ) approved → (IT รับงาน) in_progress
 *   → (IT บันทึกผล) pending_it_head → (หัวหน้า IT อนุมัติ) completed
 *   rejected / ส่งกลับแก้ไข ได้ระหว่างทาง
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('it_tickets', function (Blueprint $table) {
            $table->id();
            $table->uuid('uuid')->unique();
            $table->string('ticket_no', 30)->unique();          // IT-2026-00001
            $table->string('type', 20);                         // repair|install|grant_access|revoke_access|other
            $table->string('type_other')->nullable();           // "อื่นๆ ระบุ"
            $table->string('status', 30)->default('pending_supervisor');

            // ผู้แจ้ง + สังกัด (บันทึกค่า ณ วันที่แจ้ง)
            $table->foreignId('requester_id')->constrained('users');
            $table->foreignId('branch_id')->nullable()->constrained('branches')->nullOnDelete();
            $table->string('department', 100)->nullable();     // แผนก
            $table->string('division', 100)->nullable();       // ฝ่าย
            $table->text('details');                            // วัตถุประสงค์ / รายละเอียดความต้องการ
            $table->date('due_date')->nullable();               // วันที่ต้องการให้ดำเนินการแล้วเสร็จ
            $table->string('requester_signature')->nullable();  // ไฟล์ลายเซ็น (private disk)
            $table->timestamp('requested_at');

            // 1.1 เพิ่ม/ระงับสิทธิ์
            $table->string('person_name_th')->nullable();
            $table->string('person_name_en')->nullable();

            // 1.2 งานซ่อม
            $table->string('device_name')->nullable();
            $table->string('asset_tag', 50)->nullable();
            $table->foreignId('asset_id')->nullable()->constrained('assets')->nullOnDelete();
            $table->text('symptom')->nullable();

            // หัวหน้าผู้อนุมัติ
            $table->foreignId('approver_id')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('approved_at')->nullable();

            // เจ้าหน้าที่ IT
            $table->foreignId('assignee_id')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('accepted_at')->nullable();

            // ผลการดำเนินงาน (สำหรับเจ้าหน้าที่ IT)
            $table->string('result', 20)->nullable();             // completed|cannot_complete
            $table->date('completed_on')->nullable();
            $table->text('cannot_reason')->nullable();
            $table->string('repair_method', 20)->nullable();      // in_house|external
            $table->string('external_vendor')->nullable();
            $table->string('warranty', 20)->nullable();           // in_warranty|out_of_warranty
            $table->text('repair_details')->nullable();
            $table->string('staff_signature')->nullable();
            $table->timestamp('resulted_at')->nullable();

            // หัวหน้า/ผู้จัดการฝ่าย IT
            $table->foreignId('it_head_id')->nullable()->constrained('users')->nullOnDelete();
            $table->string('it_head_signature')->nullable();
            $table->timestamp('closed_at')->nullable();

            $table->timestamps();

            $table->index(['status', 'created_at']);
            $table->index(['requester_id', 'created_at']);
            $table->index(['assignee_id', 'status']);
            $table->index(['approver_id', 'status']);
        });

        // อะไหล่ / วัสดุที่เปลี่ยน
        Schema::create('it_ticket_parts', function (Blueprint $table) {
            $table->id();
            $table->foreignId('it_ticket_id')->constrained('it_tickets')->cascadeOnDelete();
            $table->string('name');
            $table->unsignedSmallInteger('quantity')->default(1);
            $table->string('photo_path')->nullable();
            $table->timestamps();
        });

        // รูปภาพ (รูปอุปกรณ์ตอนแจ้ง / รูปหลังซ่อม)
        Schema::create('it_ticket_attachments', function (Blueprint $table) {
            $table->id();
            $table->foreignId('it_ticket_id')->constrained('it_tickets')->cascadeOnDelete();
            $table->string('kind', 20);              // request|result
            $table->string('path');
            $table->string('original_name')->nullable();
            $table->string('mime', 100)->nullable();
            $table->unsignedInteger('size')->default(0);
            $table->foreignId('uploaded_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->index(['it_ticket_id', 'kind']);
        });

        // ประวัติการดำเนินการของใบแจ้งงาน (append-only)
        Schema::create('it_ticket_events', function (Blueprint $table) {
            $table->id();
            $table->foreignId('it_ticket_id')->constrained('it_tickets')->cascadeOnDelete();
            $table->foreignId('user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->string('action', 30);            // submitted|approved|rejected|accepted|resulted|returned|closed
            $table->text('comment')->nullable();
            $table->timestamp('created_at')->useCurrent();

            $table->index(['it_ticket_id', 'created_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('it_ticket_events');
        Schema::dropIfExists('it_ticket_attachments');
        Schema::dropIfExists('it_ticket_parts');
        Schema::dropIfExists('it_tickets');
    }
};
