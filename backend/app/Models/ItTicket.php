<?php

namespace App\Models;

use App\Enums\TicketStatus;
use App\Enums\TicketType;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Facades\DB;

/** ใบแจ้งดำเนินงาน IT */
class ItTicket extends Model
{
    use HasUuids;

    /** ฟิลด์ที่ผู้แจ้งกรอกเอง (สถานะ/ผู้อนุมัติ/ผลการดำเนินงาน ระบบเป็นผู้กำหนด) */
    protected $fillable = [
        'type', 'type_other', 'branch_id', 'department', 'division', 'details', 'due_date',
        'person_name_th', 'person_name_en', 'device_name', 'asset_tag', 'symptom', 'assignee_id',
    ];

    protected function casts(): array
    {
        return [
            'type' => TicketType::class,
            'status' => TicketStatus::class,
            'due_date' => 'date',
            'completed_on' => 'date',
            'requested_at' => 'datetime',
            'approved_at' => 'datetime',
            'accepted_at' => 'datetime',
            'resulted_at' => 'datetime',
            'closed_at' => 'datetime',
            'requester_id' => 'integer',
            'approver_id' => 'integer',
            'assignee_id' => 'integer',
            'it_head_id' => 'integer',
            'branch_id' => 'integer',
        ];
    }

    public function uniqueIds(): array
    {
        return ['uuid'];
    }

    public function getRouteKeyName(): string
    {
        return 'uuid';
    }

    /**
     * เลขที่ใบแจ้งงาน IT-YYYY-NNNNN — เรียกภายใน transaction, ล็อกกันเลขซ้ำเมื่อแจ้งพร้อมกัน
     * PostgreSQL ใช้ FOR UPDATE กับ MAX() ไม่ได้ → advisory lock (key เดียวกับ Express API จึงกันชนกันข้าม backend)
     */
    public static function nextTicketNo(): string
    {
        $prefix = 'IT-'.now()->year.'-';
        $pgsql = DB::getDriverName() === 'pgsql';
        if ($pgsql) {
            DB::select("SELECT pg_advisory_xact_lock(hashtext('it_tickets.ticket_no'))");
        }
        $last = DB::table('it_tickets')->where('ticket_no', 'like', $prefix.'%')
            ->when(! $pgsql, fn ($q) => $q->lockForUpdate())
            ->max('ticket_no');
        $seq = $last ? ((int) substr($last, strlen($prefix))) + 1 : 1;

        return $prefix.str_pad((string) $seq, 5, '0', STR_PAD_LEFT);
    }

    public function scopeOpen(Builder $q): Builder
    {
        return $q->whereNotIn('status', [TicketStatus::Completed->value, TicketStatus::Rejected->value]);
    }

    public function requester(): BelongsTo
    {
        return $this->belongsTo(User::class, 'requester_id');
    }

    public function approver(): BelongsTo
    {
        return $this->belongsTo(User::class, 'approver_id');
    }

    public function assignee(): BelongsTo
    {
        return $this->belongsTo(User::class, 'assignee_id');
    }

    public function itHead(): BelongsTo
    {
        return $this->belongsTo(User::class, 'it_head_id');
    }

    public function branch(): BelongsTo
    {
        return $this->belongsTo(Branch::class);
    }

    public function asset(): BelongsTo
    {
        return $this->belongsTo(Asset::class);
    }

    public function parts(): HasMany
    {
        return $this->hasMany(ItTicketPart::class);
    }

    public function attachments(): HasMany
    {
        return $this->hasMany(ItTicketAttachment::class);
    }

    public function events(): HasMany
    {
        return $this->hasMany(ItTicketEvent::class);
    }

    public function log(?User $user, string $action, ?string $comment = null): void
    {
        $this->events()->create(['user_id' => $user?->id, 'action' => $action, 'comment' => $comment]);
    }
}
