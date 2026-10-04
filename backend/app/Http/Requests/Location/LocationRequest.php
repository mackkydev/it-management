<?php

namespace App\Http\Requests\Location;

use App\Models\Location;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

/**
 * ใช้ทั้งเพิ่ม (POST) และแก้ไข (PUT/PATCH) สถานที่ — PATCH ส่งเฉพาะฟิลด์ที่แก้ได้
 */
class LocationRequest extends FormRequest
{
    public const TYPES = ['site', 'building', 'floor', 'room', 'warehouse'];

    public function authorize(): bool
    {
        return true; // ตรวจด้วย LocationPolicy ใน Controller
    }

    public function rules(): array
    {
        /** @var Location|null $current */
        $current = $this->route('location');
        $sometimes = $current ? ['sometimes'] : [];

        return [
            'code' => [...$sometimes, 'required', 'string', 'max:50', 'regex:/^[A-Za-z0-9\-_\/]+$/', Rule::unique('locations', 'code')->ignore($current)],
            'name' => [...$sometimes, 'required', 'string', 'max:255'],
            'type' => [...$sometimes, 'required', Rule::in(self::TYPES)],
            'parent_id' => ['sometimes', 'nullable', 'integer', Rule::exists('locations', 'id')->whereNull('deleted_at')],
            'address' => ['sometimes', 'nullable', 'string', 'max:2000'],
            'is_active' => ['sometimes', 'boolean'],
        ];
    }

    /** ป้องกันโครงสร้างวนซ้ำ: สถานที่แม่ต้องไม่ใช่ตัวเองหรือสถานที่ย่อยของตัวเอง */
    public function after(): array
    {
        return [
            function (Validator $validator) {
                /** @var Location|null $current */
                $current = $this->route('location');
                $parentId = $this->input('parent_id');
                if (! $current || ! $parentId || $validator->errors()->has('parent_id')) {
                    return;
                }

                $seen = 0;
                $id = (int) $parentId;
                while ($id && $seen++ < 50) {
                    if ($id === $current->id) {
                        $validator->errors()->add('parent_id', __('eam.location.invalid_parent'));
                        return;
                    }
                    $id = (int) Location::whereKey($id)->value('parent_id');
                }
            },
        ];
    }

    public function messages(): array
    {
        return [
            'code.regex' => __('eam.location.code_format'),
        ];
    }
}
