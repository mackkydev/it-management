<?php

namespace App\Models;

use Carbon\CarbonInterface;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;

/** สัญญากับ vendor — แจ้งเตือนล่วงหน้าก่อนหมดอายุตามจำนวนวันที่กำหนด */
class Contract extends Model
{
    use SoftDeletes;

    protected $fillable = [
        'title', 'vendor_name', 'contract_no', 'start_date', 'end_date', 'amount',
        'contact_name', 'contact_email', 'contact_phone',
        'notify_days_before', 'notify_enabled', 'notes', 'branch_id',
    ];

    protected function casts(): array
    {
        return [
            'start_date' => 'date',
            'end_date' => 'date',
            'notified_for_end_date' => 'date',
            'notified_at' => 'datetime',
            'amount' => 'decimal:2',
            'notify_enabled' => 'boolean',
            'notify_days_before' => 'integer',
            'branch_id' => 'integer',
        ];
    }

    public function branch(): BelongsTo
    {
        return $this->belongsTo(Branch::class);
    }

    /** จำนวนวันแจ้งเตือนที่ใช้จริง: ของสัญญาเอง หรือค่าเริ่มต้นจากหน้าตั้งค่า */
    public function effectiveNotifyDays(): int
    {
        return $this->notify_days_before ?? (int) AppSetting::get('contract_notify_days', 30);
    }

    public function daysLeft(?CarbonInterface $today = null): int
    {
        return (int) ($today ?? now())->startOfDay()->diffInDays($this->end_date->copy()->startOfDay(), false);
    }

    /** active | expiring | expired */
    public function status(): string
    {
        $left = $this->daysLeft();

        return match (true) {
            $left < 0 => 'expired',
            $left <= $this->effectiveNotifyDays() => 'expiring',
            default => 'active',
        };
    }
}
