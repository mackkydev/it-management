<?php

namespace App\Http\Resources;

use App\Models\ItTicket;
use App\Models\User;
use App\Services\TicketWorkflow;

/**
 * รูปแบบ JSON ของใบแจ้งงาน — summary (รายการ) / detail (หน้ารายละเอียด)
 * ไฟล์ไม่ส่ง path จริง ส่งเป็น id ให้เรียกผ่าน /tickets/{uuid}/files/... (ตรวจสิทธิ์)
 */
class TicketResource
{
    public function __construct(private ItTicket $t) {}

    private static function person(?User $u): ?array
    {
        return $u ? ['id' => $u->id, 'name' => $u->name] : null;
    }

    public function summary(User $viewer, TicketWorkflow $flow): array
    {
        $t = $this->t;

        return [
            'id' => $t->uuid,
            'ticket_no' => $t->ticket_no,
            'type' => $t->type->value,
            'type_other' => $t->type_other,
            'status' => $t->status->value,
            'details' => mb_strimwidth($t->details, 0, 160, '…'),
            'requester' => self::person($t->requester),
            'assignee' => self::person($t->assignee),
            'branch' => $t->branch ? ['id' => $t->branch->id, 'name' => $t->branch->name] : null,
            'due_date' => $t->due_date?->toDateString(),
            'requested_at' => $t->requested_at->toIso8601String(),
            'actions' => $flow->actionsFor($viewer, $t),
        ];
    }

    public function detail(User $viewer, TicketWorkflow $flow): array
    {
        $t = $this->t;
        $file = fn (string $kind, ?int $id = null) => "/tickets/{$t->uuid}/files/{$kind}".($id ? "/{$id}" : '');

        return [
            ...$this->summary($viewer, $flow),
            'details' => $t->details,
            'department' => $t->department,
            'division' => $t->division,
            'requester' => $t->requester ? ['id' => $t->requester->id, 'name' => $t->requester->name, 'email' => $t->requester->email] : null,
            'person_name_th' => $t->person_name_th,
            'person_name_en' => $t->person_name_en,
            'device_name' => $t->device_name,
            'asset_tag' => $t->asset_tag,
            'asset' => $t->asset ? ['id' => $t->asset->uuid, 'asset_tag' => $t->asset->asset_tag, 'name' => $t->asset->name] : null,
            'symptom' => $t->symptom,
            'approver' => self::person($t->approver),
            'approved_at' => $t->approved_at?->toIso8601String(),
            'accepted_at' => $t->accepted_at?->toIso8601String(),
            'result' => $t->result,
            'completed_on' => $t->completed_on?->toDateString(),
            'cannot_reason' => $t->cannot_reason,
            'repair_method' => $t->repair_method,
            'external_vendor' => $t->external_vendor,
            'warranty' => $t->warranty,
            'repair_details' => $t->repair_details,
            'resulted_at' => $t->resulted_at?->toIso8601String(),
            'it_head' => self::person($t->itHead),
            'closed_at' => $t->closed_at?->toIso8601String(),
            'signatures' => [
                // สำเนาตอนแจ้งงาน หรือลายเซ็นปัจจุบันในโปรไฟล์ผู้แจ้ง (แสตมป์ตอนดู/พิมพ์)
                'requester' => $t->requester_signature || $t->requester?->signature_path ? $file('requester-signature') : null,
                'staff' => $t->staff_signature ? $file('staff-signature') : null,
                'it_head' => $t->it_head_signature ? $file('it-head-signature') : null,
            ],
            'attachments' => $t->attachments->map(fn ($a) => [
                'id' => $a->id,
                'kind' => $a->kind,
                'name' => $a->original_name,
                'mime' => $a->mime,
                'size' => $a->size,
                'url' => $file('attachment', $a->id),
            ])->values(),
            'parts' => $t->parts->map(fn ($p) => [
                'id' => $p->id,
                'name' => $p->name,
                'quantity' => $p->quantity,
                'photo_url' => $p->photo_path ? $file('part', $p->id) : null,
            ])->values(),
            'events' => $t->events->sortBy('id')->map(fn ($e) => [
                'id' => $e->id,
                'action' => $e->action,
                'comment' => $e->comment,
                'user' => self::person($e->user),
                'created_at' => $e->created_at->toIso8601String(),
            ])->values(),
        ];
    }
}
