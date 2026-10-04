<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/** รูปภาพแนบใบแจ้งงาน — kind: request (ตอนแจ้ง) | result (หลังซ่อม) เก็บใน private disk */
class ItTicketAttachment extends Model
{
    protected $fillable = ['kind', 'path', 'original_name', 'mime', 'size', 'uploaded_by'];
}
