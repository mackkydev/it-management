<?php

namespace App\Http\Requests\Auth;

use Illuminate\Foundation\Http\FormRequest;

class LoginRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'email' => ['required', 'string', 'email', 'max:255'],
            'password' => ['required', 'string', 'max:255'],
            // ชื่ออุปกรณ์ใช้ระบุ token แต่ละเครื่อง เช่น "web", "iPhone 16 - Somchai"
            'device_name' => ['required', 'string', 'max:100'],
        ];
    }
}
