<?php

namespace App\Console\Commands;

use App\Models\AppSetting;
use App\Models\Contract;
use App\Models\Credential;
use App\Models\User;
use App\Notifications\ExpiringItemsDigest;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Notification;

/**
 * แจ้งเตือนรายการใกล้หมดอายุ (รันทุกวันผ่าน Scheduler)
 * - สัญญา: เมื่อเหลือ ≤ N วัน (N ของสัญญา หรือค่าเริ่มต้นในหน้าตั้งค่า)
 * - บัญชี/รหัสผ่าน: เมื่อเหลือ ≤ credential_notify_days วัน
 * แจ้งครั้งเดียวต่อวันหมดอายุ (ต่ออายุแล้ววันหมดอายุเปลี่ยน → แจ้งใหม่ได้)
 */
class NotifyExpiringItems extends Command
{
    protected $signature = 'it:notify-expiring {--dry-run : แสดงรายการโดยไม่ส่งจริง}';

    protected $description = 'แจ้งเตือนสัญญาและบัญชีที่ใกล้หมดอายุ ทางอีเมลและในระบบ';

    public function handle(): int
    {
        $today = now()->startOfDay();
        $items = [];
        $contracts = collect();
        $credentials = collect();

        Contract::query()->where('notify_enabled', true)->whereDate('end_date', '>=', $today->copy()->subDays(1))->get()
            ->each(function (Contract $c) use (&$items, $contracts, $today) {
                $left = $c->daysLeft($today);
                $already = $c->notified_for_end_date?->isSameDay($c->end_date);
                if ($left <= $c->effectiveNotifyDays() && ! $already) {
                    $items[] = ['type' => 'contract', 'title' => $c->title, 'sub' => $c->vendor_name, 'date' => $c->end_date->toDateString(), 'days_left' => $left];
                    $contracts->push($c);
                }
            });

        $credentialDays = (int) AppSetting::get('credential_notify_days', 14);
        Credential::query()->whereNotNull('expires_at')
            ->whereDate('expires_at', '<=', $today->copy()->addDays($credentialDays))
            ->whereDate('expires_at', '>=', $today->copy()->subDays(1))
            ->get()
            ->each(function (Credential $c) use (&$items, $credentials, $today) {
                if ($c->notified_for_expires_at && $c->notified_for_expires_at === $c->expires_at->toDateString()) {
                    return;
                }
                $items[] = ['type' => 'credential', 'title' => $c->title, 'sub' => $c->username, 'date' => $c->expires_at->toDateString(), 'days_left' => (int) $today->diffInDays($c->expires_at, false)];
                $credentials->push($c);
            });

        if ($items === []) {
            $this->info('ไม่มีรายการใกล้หมดอายุที่ต้องแจ้ง');

            return self::SUCCESS;
        }

        $this->table(['type', 'title', 'sub', 'date', 'days_left'], $items);
        if ($this->option('dry-run')) {
            return self::SUCCESS;
        }

        $digest = new ExpiringItemsDigest($items);

        // อีเมลจากหน้าตั้งค่า (หลายอีเมล)
        foreach ((array) AppSetting::get('notify_emails', []) as $email) {
            Notification::route('mail', $email)->notify($digest);
        }
        // แจ้งเตือนในระบบ: admin + เจ้าหน้าที่ IT ที่ยังใช้งาน
        $recipients = User::query()->where('is_active', true)
            ->where(fn ($q) => $q->where('role', 'admin')->orWhere('is_it_staff', true)->orWhere('is_it_head', true))
            ->get();
        Notification::send($recipients, $digest);

        $contracts->each(fn (Contract $c) => $c->forceFill(['notified_for_end_date' => $c->end_date, 'notified_at' => now()])->save());
        $credentials->each(fn (Credential $c) => $c->forceFill(['notified_for_expires_at' => $c->expires_at->toDateString()])->save());

        $this->info('ส่งแจ้งเตือนแล้ว '.count($items).' รายการ');

        return self::SUCCESS;
    }
}
