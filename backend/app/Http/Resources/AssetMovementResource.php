<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin \App\Models\AssetMovement */
class AssetMovementResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        $location = fn ($l) => $l ? ['id' => $l->id, 'code' => $l->code, 'name' => $l->name] : null;
        $user = fn ($u) => $u ? ['id' => $u->id, 'name' => $u->name] : null;

        return [
            'id' => $this->id,
            // มีเฉพาะในรายงานรวม (GET /movements)
            'asset' => $this->whenLoaded('asset', fn () => $this->asset ? [
                'id' => $this->asset->uuid,
                'asset_tag' => $this->asset->asset_tag,
                'name' => $this->asset->name,
            ] : null),
            'type' => $this->type->value,
            'type_label' => $this->type->label(),
            'from_location' => $location($this->fromLocation),
            'to_location' => $location($this->toLocation),
            'from_custodian' => $user($this->fromCustodian),
            'to_custodian' => $user($this->toCustodian),
            'moved_at' => $this->moved_at->toIso8601String(),
            'reason' => $this->reason,
            'performed_by' => $user($this->performer),
            'created_at' => $this->created_at?->toIso8601String(),
        ];
    }
}
