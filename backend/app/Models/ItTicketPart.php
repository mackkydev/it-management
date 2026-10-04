<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/** อะไหล่ / วัสดุที่เปลี่ยน (แนบรูปได้ 1 รูป) */
class ItTicketPart extends Model
{
    protected $fillable = ['name', 'quantity', 'photo_path'];

    protected function casts(): array
    {
        return ['quantity' => 'integer'];
    }
}
