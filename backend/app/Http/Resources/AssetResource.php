<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * รูปแบบ JSON ที่ส่งให้ทั้ง Web และ Mobile — ไม่เปิดเผย primary key ภายใน
 *
 * @mixin \App\Models\Asset
 */
class AssetResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->uuid,
            'asset_tag' => $this->asset_tag,
            'name' => $this->name,
            'category' => $this->category,
            'brand' => $this->brand,
            'model' => $this->model,
            'serial_number' => $this->serial_number,
            'status' => $this->status->value,
            'status_label' => $this->status->label(),
            'location' => LocationResource::make($this->whenLoaded('location')),
            'custodian' => $this->whenLoaded('custodian', fn () => $this->custodian ? [
                'id' => $this->custodian->id,
                'name' => $this->custodian->name,
            ] : null),
            'purchase_date' => $this->purchase_date?->toDateString(),
            'purchase_cost' => $this->purchase_cost,
            'warranty_expires_at' => $this->warranty_expires_at?->toDateString(),
            'notes' => $this->notes,
            'created_at' => $this->created_at?->toIso8601String(),
            'updated_at' => $this->updated_at?->toIso8601String(),
        ];
    }
}
