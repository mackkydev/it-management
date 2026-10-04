<?php

namespace App\Policies;

use App\Enums\UserRole;
use App\Models\User;

class UserPolicy
{
    /** ดูรายชื่อผู้ใช้ (ตัวเลือกผู้ถือครอง) ได้เฉพาะผู้ที่มีสิทธิ์กำหนดผู้ถือครองสินทรัพย์ */
    public function viewAny(User $user): bool
    {
        return $user->role->canManageAssets();
    }

    /** หน้าจัดการผู้ใช้ (เห็น role / สถานะบัญชี / ผู้ใช้ที่ปิดใช้งาน) — admin เท่านั้น */
    public function manage(User $user): bool
    {
        return $user->role === UserRole::Admin;
    }

    public function view(User $user, User $target): bool
    {
        return $user->role === UserRole::Admin || $user->is($target);
    }

    public function create(User $user): bool
    {
        return $user->role === UserRole::Admin;
    }

    public function update(User $user, User $target): bool
    {
        return $user->role === UserRole::Admin;
    }

    public function delete(User $user, User $target): bool
    {
        return $user->role === UserRole::Admin;
    }
}
