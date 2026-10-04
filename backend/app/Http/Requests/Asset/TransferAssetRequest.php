<?php

namespace App\Http\Requests\Asset;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

/**
 * POST /assets/{asset}/movements — โอนย้ายโดยตรง (เช่น สแกน QR จากแอปมือถือ)
 * ส่งเฉพาะฟิลด์ที่ต้องการเปลี่ยน: location_id และ/หรือ custodian_id (ส่ง null = ยกเลิกผู้ถือครอง)
 */
class TransferAssetRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true; // ตรวจด้วย AssetPolicy::update ใน Controller
    }

    public function rules(): array
    {
        return [
            'location_id' => ['sometimes', 'nullable', 'integer', Rule::exists('locations', 'id')->whereNull('deleted_at')],
            'custodian_id' => ['sometimes', 'nullable', 'integer', Rule::exists('users', 'id')->where('is_active', true)],
            'moved_at' => ['nullable', 'date', 'before_or_equal:now'],
            'reason' => ['nullable', 'string', 'max:1000'],
        ];
    }

    public function after(): array
    {
        return [
            function (Validator $validator) {
                if (! $this->has('location_id') && ! $this->has('custodian_id')) {
                    $validator->errors()->add('location_id', __('eam.movement.nothing_to_change'));
                }
            },
        ];
    }

    public function messages(): array
    {
        return [
            'moved_at.before_or_equal' => __('eam.movement.future_date'),
        ];
    }
}
