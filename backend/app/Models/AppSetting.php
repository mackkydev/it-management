<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\Cache;

/**
 * ตั้งค่าระบบแบบ key-value (value เก็บเป็น JSON)
 *   AppSetting::get('contract_notify_days', 30)
 *   AppSetting::put('notify_emails', ['it@example.com'], $userId)
 */
class AppSetting extends Model
{
    protected $primaryKey = 'key';

    public $incrementing = false;

    protected $keyType = 'string';

    protected $fillable = ['key', 'value', 'updated_by'];

    protected function casts(): array
    {
        return ['value' => 'json'];
    }

    public const DEFAULTS = [
        'contract_notify_days' => 30,   // แจ้งเตือนสัญญาล่วงหน้า (วัน) — ค่าเริ่มต้นเมื่อสัญญาไม่ได้กำหนดเอง
        'credential_notify_days' => 14, // แจ้งเตือนรหัส/บัญชีใกล้หมดอายุ (วัน)
        'notify_emails' => [],          // อีเมลรับแจ้งเตือน (หลายอีเมล)
        // ตัวเลือกของเรื่อง "อื่นๆ" ในใบแจ้งงาน (ผู้แจ้งกรอกเองเพิ่มได้) — เป็นข้อมูลตั้งต้น admin แก้ได้ในหน้าตั้งค่า
        'ticket_other_types' => ['งานออกแบบ'],
        // หน้า "สิทธิ์การใช้งาน": key เมนู/ปุ่ม → กลุ่มที่ซ่อน, และลำดับเมนู
        'ui_permissions' => [],
        'menu_order' => [],
    ];

    private const CACHE_KEY = 'app_settings:all';

    /** @return array<string, mixed> */
    public static function allValues(): array
    {
        $stored = Cache::remember(self::CACHE_KEY, now()->addMinutes(10), fn () => static::query()->pluck('value', 'key')->all());

        return array_merge(self::DEFAULTS, $stored);
    }

    public static function get(string $key, mixed $default = null): mixed
    {
        return self::allValues()[$key] ?? $default;
    }

    public static function put(string $key, mixed $value, ?int $userId = null): void
    {
        static::query()->updateOrCreate(['key' => $key], ['value' => $value, 'updated_by' => $userId]);
        Cache::forget(self::CACHE_KEY);
    }
}
