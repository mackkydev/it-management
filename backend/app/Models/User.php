<?php

namespace App\Models;

use App\Enums\UserRole;
use Database\Factories\UserFactory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Laravel\Sanctum\HasApiTokens;

class User extends Authenticatable
{
    /** @use HasFactory<UserFactory> */
    use HasApiTokens, HasFactory, Notifiable;

    // role / is_active ไม่อยู่ใน fillable เพื่อป้องกันการยกระดับสิทธิ์ผ่าน mass assignment
    protected $fillable = [
        'name',
        'email',
        'password',
    ];

    protected $hidden = [
        'password',
        'remember_token',
    ];

    protected $attributes = [
        'role' => 'viewer',
        'is_active' => true,
        'is_it_staff' => false,
        'is_it_head' => false,
    ];

    protected function casts(): array
    {
        return [
            'email_verified_at' => 'datetime',
            'password' => 'hashed',
            'role' => UserRole::class,
            'is_active' => 'boolean',
            'is_it_staff' => 'boolean',
            'is_it_head' => 'boolean',
            'branch_id' => 'integer',
            'supervisor_id' => 'integer',
        ];
    }

    public function isAdmin(): bool
    {
        return $this->role === UserRole::Admin;
    }

    /** เจ้าหน้าที่ฝ่าย IT (รวมหัวหน้า IT) */
    public function isIt(): bool
    {
        return (bool) ($this->is_it_staff || $this->is_it_head);
    }

    /** เข้าถึงข้อมูลของแผนก IT (คลังรหัสผ่าน / สัญญา / งาน IT ทั้งหมด) */
    public function canAccessItData(): bool
    {
        return $this->isAdmin() || $this->isIt();
    }

    public function branch(): BelongsTo
    {
        return $this->belongsTo(Branch::class);
    }

    /** หัวหน้าตามสายบังคับบัญชา (ผู้อนุมัติใบแจ้งงาน) */
    public function supervisor(): BelongsTo
    {
        return $this->belongsTo(self::class, 'supervisor_id');
    }

    public function subordinates(): HasMany
    {
        return $this->hasMany(self::class, 'supervisor_id');
    }

    /** สินทรัพย์ที่ผู้ใช้นี้ถือครอง (รวมที่ถูกลบแบบ soft delete — ใช้ตรวจก่อนลบผู้ใช้) */
    public function custodianAssets(): HasMany
    {
        return $this->hasMany(Asset::class, 'custodian_id');
    }

    public function createdAssets(): HasMany
    {
        return $this->hasMany(Asset::class, 'created_by');
    }

    public function performedMovements(): HasMany
    {
        return $this->hasMany(AssetMovement::class, 'performed_by');
    }

    /** มีประวัติในระบบหรือไม่ — ถ้ามี ห้ามลบ (ให้ปิดใช้งานแทน เพื่อเก็บ audit trail) */
    public function hasHistory(): bool
    {
        return $this->custodianAssets()->withTrashed()->exists()
            || $this->createdAssets()->withTrashed()->exists()
            || $this->performedMovements()->exists()
            || AssetMovement::where('from_custodian_id', $this->id)->orWhere('to_custodian_id', $this->id)->exists()
            || ItTicket::where('requester_id', $this->id)->orWhere('assignee_id', $this->id)
                ->orWhere('approver_id', $this->id)->orWhere('it_head_id', $this->id)->exists()
            || KpiEntry::where('user_id', $this->id)->exists();
    }
}
