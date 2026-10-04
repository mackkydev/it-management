<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin \App\Models\User */
class UserResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'name' => $this->name,
            'email' => $this->email,
            'role' => $this->role->value,
            'is_active' => $this->whenHas('is_active'),
            // สังกัด / สายบังคับบัญชา / ฝ่าย IT
            'branch_id' => $this->whenHas('branch_id'),
            'branch' => $this->whenLoaded('branch', fn () => $this->branch ? ['id' => $this->branch->id, 'name' => $this->branch->name] : null),
            'department' => $this->whenHas('department'),
            'division' => $this->whenHas('division'),
            'supervisor_id' => $this->whenHas('supervisor_id'),
            'supervisor' => $this->whenLoaded('supervisor', fn () => $this->supervisor ? ['id' => $this->supervisor->id, 'name' => $this->supervisor->name] : null),
            'is_it_staff' => $this->whenHas('is_it_staff'),
            'is_it_head' => $this->whenHas('is_it_head'),
            'custodian_assets_count' => $this->whenCounted('custodianAssets'),
            // ลายเซ็นในโปรไฟล์ — ส่ง URL เฉพาะข้อมูลของผู้ที่เรียกเอง (?v= เปลี่ยนเมื่ออัปโหลดใหม่)
            'signature_url' => $this->whenHas('signature_path', fn () => $this->signature_path && $request->user()?->id === $this->id
                ? '/auth/me/signature?v='.pathinfo($this->signature_path, PATHINFO_FILENAME)
                : null),
            'created_at' => $this->whenHas('created_at', fn () => $this->created_at?->toIso8601String()),
        ];
    }
}
