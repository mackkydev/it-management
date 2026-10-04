<?php

namespace App\Enums;

enum UserRole: string
{
    case Admin = 'admin';     // จัดการได้ทั้งหมด รวมถึงลบ
    case Manager = 'manager'; // เพิ่ม/แก้ไขสินทรัพย์
    case Viewer = 'viewer';   // ดูได้อย่างเดียว

    public function canManageAssets(): bool
    {
        return in_array($this, [self::Admin, self::Manager], true);
    }
}
