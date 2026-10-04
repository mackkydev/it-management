<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** บันทึกการปฏิบัติงาน (KPI) รายวันของผู้ใช้ — ตาราง kpi_entries (สร้างด้วย Prisma) */
class KpiEntry extends Model
{
    protected $fillable = ['work_date', 'details'];

    protected function casts(): array
    {
        return ['work_date' => 'date', 'user_id' => 'integer'];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
