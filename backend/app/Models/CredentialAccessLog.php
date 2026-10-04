<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** บันทึกการเปิดดู/แก้ไขข้อมูลลับ — เพิ่มได้อย่างเดียว */
class CredentialAccessLog extends Model
{
    public const UPDATED_AT = null;

    protected $fillable = ['credential_id', 'user_id', 'action', 'ip'];

    protected function casts(): array
    {
        return ['created_at' => 'datetime'];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
