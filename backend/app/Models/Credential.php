<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * บัญชีผู้ใช้/รหัสผ่านของระบบต่างๆ ในความดูแลของฝ่าย IT
 * password / secret_notes เข้ารหัสด้วย APP_KEY (encrypted cast) — ห้ามส่งกลับใน list API
 */
class Credential extends Model
{
    use SoftDeletes;

    public const CATEGORIES = ['system', 'server', 'network', 'email', 'software', 'cloud', 'other'];

    protected $fillable = [
        'title', 'category', 'url', 'username', 'password', 'secret_notes', 'notes',
        'branch_id', 'owner_id', 'expires_at',
    ];

    protected $hidden = ['password', 'secret_notes'];

    protected function casts(): array
    {
        return [
            'password' => 'encrypted',
            'secret_notes' => 'encrypted',
            'expires_at' => 'date',
            'password_changed_at' => 'datetime',
            'branch_id' => 'integer',
            'owner_id' => 'integer',
        ];
    }

    public function branch(): BelongsTo
    {
        return $this->belongsTo(Branch::class);
    }

    public function owner(): BelongsTo
    {
        return $this->belongsTo(User::class, 'owner_id');
    }

    public function updater(): BelongsTo
    {
        return $this->belongsTo(User::class, 'updated_by');
    }

    public function accessLogs(): HasMany
    {
        return $this->hasMany(CredentialAccessLog::class);
    }
}
