<?php

namespace App\Enums;

enum AssetStatus: string
{
    case Active = 'active';
    case InStorage = 'in_storage';
    case InRepair = 'in_repair';
    case Lost = 'lost';
    case Disposed = 'disposed';

    public function label(): string
    {
        return __("eam.status.{$this->value}"); // ตามภาษาของ request (lang/{th,en}/eam.php)
    }

    /** @return list<string> */
    public static function values(): array
    {
        return array_column(self::cases(), 'value');
    }
}
