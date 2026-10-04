<?php

namespace Database\Factories;

use App\Models\Location;
use Illuminate\Database\Eloquent\Factories\Factory;

/** @extends Factory<Location> */
class LocationFactory extends Factory
{
    public function definition(): array
    {
        return [
            'code' => fake()->unique()->bothify('LOC-###??'),
            'name' => 'ห้อง '.fake()->numberBetween(100, 999),
            'type' => 'room',
            'is_active' => true,
        ];
    }
}
