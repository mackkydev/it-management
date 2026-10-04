<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * สาขา + ข้อมูลสังกัดของผู้ใช้ (สาขา / แผนก / ฝ่าย / หัวหน้าตามสายบังคับบัญชา) + สิทธิ์ฝ่าย IT
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('branches', function (Blueprint $table) {
            $table->id();
            $table->string('code', 30)->unique();
            $table->string('name');
            $table->unsignedSmallInteger('sort_order')->default(0);
            $table->boolean('is_active')->default(true);
            $table->timestamps();
            $table->softDeletes();

            $table->index(['is_active', 'sort_order']);
        });

        Schema::table('users', function (Blueprint $table) {
            $table->foreignId('branch_id')->nullable()->after('is_active')->constrained('branches')->nullOnDelete();
            $table->string('department', 100)->nullable()->after('branch_id'); // แผนก
            $table->string('division', 100)->nullable()->after('department');  // ฝ่าย
            // หัวหน้าตามสายบังคับบัญชา — ผู้อนุมัติใบแจ้งงานของผู้ใช้นี้
            $table->foreignId('supervisor_id')->nullable()->after('division')->constrained('users')->nullOnDelete();
            $table->boolean('is_it_staff')->default(false)->after('supervisor_id'); // เจ้าหน้าที่ IT (รับงาน/บันทึกผล)
            $table->boolean('is_it_head')->default(false)->after('is_it_staff');    // หัวหน้า/ผู้จัดการฝ่าย IT (อนุมัติผล)
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropConstrainedForeignId('supervisor_id');
            $table->dropConstrainedForeignId('branch_id');
            $table->dropColumn(['department', 'division', 'is_it_staff', 'is_it_head']);
        });
        Schema::dropIfExists('branches');
    }
};
