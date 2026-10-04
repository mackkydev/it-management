<?php

namespace App\Models;

use App\Enums\AssetStatus;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

class Asset extends Model
{
    use HasFactory, HasUuids, SoftDeletes;

    /**
     * กำหนดเฉพาะฟิลด์ที่ผู้ใช้แก้ไขได้ (ป้องกัน Mass Assignment)
     * created_by / updated_by ถูกกำหนดโดยระบบใน Controller
     */
    protected $fillable = [
        'asset_tag',
        'name',
        'category',
        'brand',
        'model',
        'serial_number',
        'status',
        'location_id',
        'custodian_id',
        'purchase_date',
        'purchase_cost',
        'warranty_expires_at',
        'notes',
    ];

    protected $attributes = [
        'status' => 'active',
    ];

    protected function casts(): array
    {
        return [
            'status' => AssetStatus::class,
            'location_id' => 'integer',
            'custodian_id' => 'integer',
            'purchase_date' => 'date',
            'warranty_expires_at' => 'date',
            'purchase_cost' => 'decimal:2',
        ];
    }

    /** ให้ HasUuids สร้างค่าเฉพาะคอลัมน์ uuid (primary key ยังเป็น bigint) */
    public function uniqueIds(): array
    {
        return ['uuid'];
    }

    /** Route model binding ด้วย uuid: /api/v1/assets/{uuid} */
    public function getRouteKeyName(): string
    {
        return 'uuid';
    }

    public function location(): BelongsTo
    {
        return $this->belongsTo(Location::class);
    }

    public function custodian(): BelongsTo
    {
        return $this->belongsTo(User::class, 'custodian_id');
    }

    public function movements(): HasMany
    {
        return $this->hasMany(AssetMovement::class);
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    /**
     * ค้นหาด้วยคำค้น (ไม่สนตัวพิมพ์): asset_tag / serial ใช้ prefix match
     * ชื่อ/ยี่ห้อ/รุ่น ค้นหาบางส่วนของคำ — PostgreSQL ใช้ index trigram (เหมือน Express API)
     */
    public function scopeSearch(Builder $query, ?string $term): Builder
    {
        $term = trim((string) $term);
        if ($term === '') {
            return $query;
        }

        $escaped = addcslashes($term, '%_\\');

        return $query->where(function (Builder $q) use ($term, $escaped) {
            $q->whereLike('asset_tag', $escaped.'%')
                ->orWhereLike('serial_number', $escaped.'%');

            if (in_array($q->getConnection()->getDriverName(), ['mariadb', 'mysql'], true)) {
                $q->orWhereFullText(['name', 'brand', 'model'], $term);
            } else {
                $q->orWhereLike('name', '%'.$escaped.'%')
                    ->orWhereLike('brand', '%'.$escaped.'%')
                    ->orWhereLike('model', '%'.$escaped.'%');
            }
        });
    }
}
