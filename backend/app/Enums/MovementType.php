<?php

namespace App\Enums;

enum MovementType: string
{
    case Registered = 'registered'; // ลงทะเบียนครั้งแรก (มีสถานที่/ผู้ถือครองตั้งต้น)
    case Transfer = 'transfer';     // โอนย้ายสถานที่ และ/หรือ เปลี่ยนผู้ถือครอง

    public function label(): string
    {
        return __("eam.movement_type.{$this->value}");
    }
}
