<?php

namespace App\Http\Requests\User;

use App\Enums\UserRole;
use App\Models\User;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Rules\Password;
use Illuminate\Validation\Validator;

/**
 * เพิ่ม (POST) / แก้ไข (PATCH) ผู้ใช้โดย admin
 * - เพิ่ม: ต้องตั้งรหัสผ่านเริ่มต้น
 * - แก้ไข: ส่ง password มาเมื่อต้องการรีเซ็ตเท่านั้น
 */
class UserRequest extends FormRequest
{
    /** ตรวจสิทธิ์ก่อน validate — ผู้ที่ไม่ใช่ admin ได้ 403 ทันที ไม่เห็นรายละเอียดกฎของฟอร์ม */
    public function authorize(): bool
    {
        $target = $this->route('user');

        return $target
            ? $this->user()->can('update', $target)
            : $this->user()->can('create', User::class);
    }

    public function rules(): array
    {
        /** @var User|null $target */
        $target = $this->route('user');
        $sometimes = $target ? ['sometimes'] : [];

        return [
            'name' => [...$sometimes, 'required', 'string', 'max:255'],
            'email' => [...$sometimes, 'required', 'string', 'email', 'max:255', Rule::unique('users', 'email')->ignore($target)],
            'role' => [...$sometimes, 'required', Rule::enum(UserRole::class)],
            'is_active' => ['sometimes', 'boolean'],
            'password' => [$target ? 'nullable' : 'required', 'string', Password::min(8)->letters()->numbers()],
            // สังกัด + สายบังคับบัญชา + สิทธิ์ฝ่าย IT
            'branch_id' => ['sometimes', 'nullable', 'integer', Rule::exists('branches', 'id')->whereNull('deleted_at')],
            'department' => ['sometimes', 'nullable', 'string', 'max:100'],
            'division' => ['sometimes', 'nullable', 'string', 'max:100'],
            'supervisor_id' => [
                'sometimes', 'nullable', 'integer', Rule::exists('users', 'id')->where('is_active', true),
                Rule::notIn(array_filter([$target?->id])), // เป็นหัวหน้าตัวเองไม่ได้
            ],
            'is_it_staff' => ['sometimes', 'boolean'],
            'is_it_head' => ['sometimes', 'boolean'],
        ];
    }

    /** กัน admin ล็อกตัวเองออกจากระบบ: ห้ามลดบทบาทหรือปิดใช้งานบัญชีตัวเอง */
    public function after(): array
    {
        return [
            function (Validator $validator) {
                $target = $this->route('user');
                if (! $target || ! $this->user()->is($target)) {
                    return;
                }
                if ($this->has('role') && $this->input('role') !== UserRole::Admin->value) {
                    $validator->errors()->add('role', __('eam.user.self_lock'));
                }
                if ($this->has('is_active') && ! $this->boolean('is_active')) {
                    $validator->errors()->add('is_active', __('eam.user.self_lock'));
                }
            },
        ];
    }
}
