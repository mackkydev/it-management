<?php

namespace App\Services;

use App\Enums\TicketStatus;
use App\Models\ItTicket;
use App\Models\User;
use App\Notifications\TicketActivity;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Notification;

/**
 * กติกาของขั้นตอนใบแจ้งงาน (ใครทำอะไรได้ในสถานะไหน) + ผู้รับแจ้งเตือนของแต่ละขั้น
 */
class TicketWorkflow
{
    public function canView(User $u, ItTicket $t): bool
    {
        return $u->isAdmin() || $u->isIt()
            || in_array($u->id, [$t->requester_id, $t->approver_id, $t->assignee_id, $t->it_head_id], true);
    }

    /** หัวหน้าตามสายบังคับบัญชาของผู้แจ้ง — ถ้าผู้แจ้งไม่มีหัวหน้า admin เป็นผู้อนุมัติแทน */
    public function canApprove(User $u, ItTicket $t): bool
    {
        return $t->status === TicketStatus::PendingSupervisor
            && ($u->id === $t->approver_id || $u->isAdmin());
    }

    /** เจ้าหน้าที่ IT รับงาน: ผู้ที่ถูกเลือกไว้ หรือ IT คนใดก็ได้ถ้ายังไม่ได้เลือก (หัวหน้า IT/admin รับแทนได้) */
    public function canAccept(User $u, ItTicket $t): bool
    {
        return $t->status === TicketStatus::Approved
            && ($u->isAdmin() || $u->is_it_head || ($u->is_it_staff && in_array($t->assignee_id, [null, $u->id], true)));
    }

    public function canRecordResult(User $u, ItTicket $t): bool
    {
        return $t->status === TicketStatus::InProgress
            && ($u->id === $t->assignee_id || $u->is_it_head || $u->isAdmin());
    }

    public function canClose(User $u, ItTicket $t): bool
    {
        return $t->status === TicketStatus::PendingItHead && ($u->is_it_head || $u->isAdmin());
    }

    /** การกระทำที่ผู้ใช้ทำได้ตอนนี้ (frontend ใช้แสดงปุ่ม) */
    public function actionsFor(User $u, ItTicket $t): array
    {
        return array_keys(array_filter([
            'approve' => $this->canApprove($u, $t),
            'reject' => $this->canApprove($u, $t),
            'accept' => $this->canAccept($u, $t),
            'result' => $this->canRecordResult($u, $t),
            'close' => $this->canClose($u, $t),
            'return' => $this->canClose($u, $t),
        ]));
    }

    public function itStaff(): Collection
    {
        return User::query()->where('is_active', true)
            ->where(fn ($q) => $q->where('is_it_staff', true)->orWhere('is_it_head', true))->get();
    }

    public function itHeads(): Collection
    {
        $heads = User::query()->where('is_active', true)->where('is_it_head', true)->get();

        return $heads->isNotEmpty() ? $heads : User::query()->where('is_active', true)->where('role', 'admin')->get();
    }

    public function approvers(ItTicket $t): Collection
    {
        if ($t->approver_id && ($approver = User::query()->whereKey($t->approver_id)->where('is_active', true)->first())) {
            return collect([$approver]);
        }

        return User::query()->where('is_active', true)->where('role', 'admin')->get();
    }

    /** แจ้งเตือนผู้เกี่ยวข้องของแต่ละเหตุการณ์ (ไม่แจ้งผู้ที่เป็นคนกดเอง) */
    public function notify(ItTicket $t, string $event, ?User $actor): void
    {
        $requester = User::find($t->requester_id);
        $assignee = $t->assignee_id ? User::find($t->assignee_id) : null;

        $recipients = match ($event) {
            'submitted' => $this->approvers($t),
            'approved' => collect([$requester])->merge($assignee ? [$assignee] : $this->itStaff()),
            'rejected', 'accepted' => collect([$requester]),
            'resulted' => $this->itHeads(),
            'returned' => collect([$assignee]),
            'closed' => collect([$requester, $assignee]),
            default => collect(),
        };

        $recipients = $recipients->filter()->unique('id')->reject(fn (User $u) => $actor && $u->id === $actor->id);
        if ($recipients->isNotEmpty()) {
            Notification::send($recipients, new TicketActivity($t, $event, $actor));
        }
    }
}
