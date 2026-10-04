<?php

namespace App\Http\Requests\Asset;

use Illuminate\Validation\Rule;

/**
 * รองรับทั้ง PUT และ PATCH: ทุกฟิลด์เป็น "sometimes" (ตรวจเฉพาะฟิลด์ที่ส่งมา)
 * แต่ฟิลด์ที่ required ถ้าส่งมาต้องไม่ว่าง
 */
class UpdateAssetRequest extends StoreAssetRequest
{
    public function rules(): array
    {
        $rules = parent::rules();

        $rules['asset_tag'] = [
            'required', 'string', 'max:50', 'regex:/^[A-Za-z0-9\-_\/]+$/',
            Rule::unique('assets', 'asset_tag')->ignore($this->route('asset')),
        ];

        // เหตุผลการโอนย้าย (ใช้เมื่อสถานที่/ผู้ถือครองเปลี่ยน — บันทึกลง asset_movements)
        $rules['movement_reason'] = ['nullable', 'string', 'max:1000'];

        return array_map(
            fn (array $fieldRules) => array_merge(['sometimes'], array_values(array_diff($fieldRules, ['sometimes']))),
            $rules,
        );
    }
}
