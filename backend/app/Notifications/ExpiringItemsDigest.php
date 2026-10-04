<?php

namespace App\Notifications;

use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Notifications\Notification;

/**
 * สรุปรายการใกล้หมดอายุ (สัญญา vendor / บัญชี-รหัสผ่าน)
 * - ส่งอีเมลไปยังอีเมลที่ตั้งค่าไว้ (ไม่ใส่ข้อมูลลับในอีเมล)
 * - แจ้งเตือนในระบบ (กระดิ่ง) ให้ admin และเจ้าหน้าที่ IT
 *
 * @param  array<int, array{type: string, title: string, sub: ?string, date: string, days_left: int}>  $items
 */
class ExpiringItemsDigest extends Notification
{
    public function __construct(public array $items) {}

    public function via(object $notifiable): array
    {
        // AnonymousNotifiable (อีเมลจากหน้าตั้งค่า) → mail, ผู้ใช้ในระบบ → database
        return $notifiable instanceof \Illuminate\Notifications\AnonymousNotifiable ? ['mail'] : ['database'];
    }

    public function toMail(object $notifiable): MailMessage
    {
        $mail = (new MailMessage)
            ->subject(__('eam.expiring.subject', ['count' => count($this->items)]))
            ->greeting(__('eam.expiring.greeting'))
            ->line(__('eam.expiring.intro'));

        foreach ($this->items as $item) {
            $mail->line(sprintf(
                '• [%s] %s%s — %s (%s)',
                __("eam.expiring.type.{$item['type']}"),
                $item['title'],
                $item['sub'] ? " / {$item['sub']}" : '',
                $item['date'],
                $item['days_left'] < 0
                    ? __('eam.expiring.expired')
                    : __('eam.expiring.days_left', ['days' => $item['days_left']]),
            ));
        }

        $frontend = rtrim((string) (config('eam.frontend_urls')[0] ?? ''), '/');

        return $mail->action(__('eam.expiring.open'), $frontend.'/contracts');
    }

    public function toArray(object $notifiable): array
    {
        return ['kind' => 'expiring', 'count' => count($this->items), 'items' => array_slice($this->items, 0, 10)];
    }
}
