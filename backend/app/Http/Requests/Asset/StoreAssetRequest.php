<?php

namespace App\Http\Requests\Asset;

use App\Enums\AssetStatus;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreAssetRequest extends FormRequest
{
    // สิทธิ์ตรวจด้วย AssetPolicy ใน Controller
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'asset_tag' => ['required', 'string', 'max:50', 'regex:/^[A-Za-z0-9\-_\/]+$/', Rule::unique('assets', 'asset_tag')],
            'name' => ['required', 'string', 'max:255'],
            'category' => ['required', 'string', 'max:50'],
            'brand' => ['nullable', 'string', 'max:100'],
            'model' => ['nullable', 'string', 'max:100'],
            'serial_number' => ['nullable', 'string', 'max:100'],
            'status' => ['sometimes', Rule::enum(AssetStatus::class)],
            'location_id' => ['nullable', 'integer', Rule::exists('locations', 'id')->whereNull('deleted_at')],
            'custodian_id' => ['nullable', 'integer', Rule::exists('users', 'id')->where('is_active', true)],
            'purchase_date' => ['nullable', 'date', 'before_or_equal:today'],
            'purchase_cost' => ['nullable', 'numeric', 'min:0', 'max:9999999999999.99'],
            'warranty_expires_at' => ['nullable', 'date'],
            'notes' => ['nullable', 'string', 'max:5000'],
        ];
    }

    /**
     * ข้อความเฉพาะของฟอร์มสินทรัพย์ — แปลตามภาษาของ request (Accept-Language)
     * ข้อความทั่วไปและชื่อฟิลด์อยู่ใน lang/th/validation.php
     */
    public function messages(): array
    {
        return [
            'asset_tag.regex' => __('eam.validation.asset_tag_regex'),
            'asset_tag.unique' => __('eam.validation.asset_tag_unique'),
            'purchase_date.before_or_equal' => __('eam.validation.purchase_date_future'),
        ];
    }
}
