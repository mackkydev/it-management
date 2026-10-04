<?php

namespace App\Enums;

enum TicketStatus: string
{
    case PendingSupervisor = 'pending_supervisor'; // รอหัวหน้าอนุมัติ
    case Approved = 'approved';                    // อนุมัติแล้ว รอ IT รับงาน
    case InProgress = 'in_progress';               // IT กำลังดำเนินการ
    case PendingItHead = 'pending_it_head';        // รอหัวหน้า IT อนุมัติผล
    case Completed = 'completed';                  // ปิดงาน
    case Rejected = 'rejected';                    // หัวหน้าไม่อนุมัติ

    public function label(): string
    {
        return __("eam.ticket_status.{$this->value}");
    }

    public function isOpen(): bool
    {
        return ! in_array($this, [self::Completed, self::Rejected], true);
    }
}
