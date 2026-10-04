<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('locations', function (Blueprint $table) {
            $table->id();
            $table->string('code', 50)->unique();              // เช่น HQ-B1-F3-R301
            $table->string('name');
            $table->string('type', 20)->default('room');       // site | building | floor | room | warehouse
            // โครงสร้างแบบลำดับชั้น: สาขา > อาคาร > ชั้น > ห้อง
            $table->foreignId('parent_id')->nullable()
                ->constrained('locations')->nullOnDelete();
            $table->text('address')->nullable();
            $table->boolean('is_active')->default(true);
            $table->timestamps();
            $table->softDeletes();

            $table->index(['is_active', 'name']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('locations');
    }
};
