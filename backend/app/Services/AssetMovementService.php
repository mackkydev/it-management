<?php

namespace App\Services;

use App\Enums\MovementType;
use App\Models\Asset;
use App\Models\AssetMovement;
use App\Models\User;
use Carbon\CarbonInterface;

/**
 * จุดเดียวที่สร้างประวัติการโอนย้าย — ทั้งจากการแก้ไขสินทรัพย์ปกติ และ endpoint โอนย้ายโดยตรง
 * ต้องเรียกภายใน DB transaction เดียวกับการบันทึก asset
 */
class AssetMovementService
{
    /** บันทึกตำแหน่งตั้งต้นตอนลงทะเบียนสินทรัพย์ใหม่ (ถ้ามีสถานที่หรือผู้ถือครอง) */
    public function recordRegistration(Asset $asset, User $by): ?AssetMovement
    {
        if ($asset->location_id === null && $asset->custodian_id === null) {
            return null;
        }

        return $asset->movements()->create([
            'type' => MovementType::Registered,
            'to_location_id' => $asset->location_id,
            'to_custodian_id' => $asset->custodian_id,
            'moved_at' => now(),
            'performed_by' => $by->id,
        ]);
    }

    /**
     * บันทึกเมื่อสถานที่หรือผู้ถือครองเปลี่ยนจากค่าเดิม — คืน null ถ้าไม่มีการเปลี่ยนแปลง
     * ค่า from_* ที่ไม่ได้เปลี่ยนจะเก็บเท่ากับ to_* เพื่อให้แต่ละแถวอ่านเข้าใจได้ด้วยตัวเอง
     */
    public function recordIfMoved(
        Asset $asset,
        ?int $fromLocationId,
        ?int $fromCustodianId,
        User $by,
        ?string $reason = null,
        ?CarbonInterface $movedAt = null,
    ): ?AssetMovement {
        if ($fromLocationId === $asset->location_id && $fromCustodianId === $asset->custodian_id) {
            return null;
        }

        return $asset->movements()->create([
            'type' => MovementType::Transfer,
            'from_location_id' => $fromLocationId,
            'to_location_id' => $asset->location_id,
            'from_custodian_id' => $fromCustodianId,
            'to_custodian_id' => $asset->custodian_id,
            'moved_at' => $movedAt ?? now(),
            'reason' => $reason,
            'performed_by' => $by->id,
        ]);
    }
}
