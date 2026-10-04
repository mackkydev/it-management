<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * ข้อมูลผู้ใช้แบบย่อสำหรับตัวเลือก (ไม่เปิดเผย role / สถานะบัญชี)
 *
 * @mixin \App\Models\User
 */
class UserOptionResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'name' => $this->name,
            'email' => $this->email,
        ];
    }
}
