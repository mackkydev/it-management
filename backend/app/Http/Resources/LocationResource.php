<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin \App\Models\Location */
class LocationResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'code' => $this->code,
            'name' => $this->name,
            'type' => $this->type,
            'parent_id' => $this->parent_id,
            // whenHas: บางที่ select เฉพาะบางคอลัมน์ (เช่น relation ใน AssetResource)
            'address' => $this->whenHas('address'),
            'is_active' => $this->whenHas('is_active'),
            'assets_count' => $this->whenCounted('assets'),
            'children_count' => $this->whenCounted('children'),
        ];
    }
}
