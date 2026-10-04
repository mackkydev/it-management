<?php

namespace App\Notifications;

use App\Models\ItTicket;
use App\Models\User;
use Illuminate\Notifications\Notification;

/**
 * แจ้งเตือนในระบบ (กระดิ่ง) เมื่อใบแจ้งงานเปลี่ยนสถานะ
 * event: submitted | approved | rejected | assigned | accepted | resulted | returned | closed
 * frontend แปลข้อความเองตาม event (รองรับไทย/อังกฤษ)
 */
class TicketActivity extends Notification
{
    public function __construct(
        public ItTicket $ticket,
        public string $event,
        public ?User $actor = null,
    ) {}

    public function via(object $notifiable): array
    {
        return ['database'];
    }

    public function toArray(object $notifiable): array
    {
        return [
            'kind' => 'ticket',
            'event' => $this->event,
            'ticket_id' => $this->ticket->uuid,
            'ticket_no' => $this->ticket->ticket_no,
            'ticket_type' => $this->ticket->type->value,
            'actor' => $this->actor?->name,
        ];
    }
}
