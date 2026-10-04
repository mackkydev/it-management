<?php

namespace App\Enums;

/** เรื่องของใบแจ้งดำเนินงาน IT */
enum TicketType: string
{
    case Repair = 'repair';              // ซ่อม (เพิ่มข้อมูล 1.2)
    case Install = 'install';            // ติดตั้ง
    case GrantAccess = 'grant_access';   // เพิ่มสิทธิ์ (เพิ่มข้อมูล 1.1)
    case RevokeAccess = 'revoke_access'; // ระงับสิทธิ์ (เพิ่มข้อมูล 1.1)
    case Other = 'other';                // อื่นๆ ระบุ

    public function needsPerson(): bool
    {
        return in_array($this, [self::GrantAccess, self::RevokeAccess], true);
    }

    public function label(): string
    {
        return __("eam.ticket_type.{$this->value}");
    }
}
