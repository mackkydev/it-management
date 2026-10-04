<?php

namespace Database\Factories;

use App\Enums\AssetStatus;
use App\Models\Asset;
use Illuminate\Database\Eloquent\Factories\Factory;

/** @extends Factory<Asset> */
class AssetFactory extends Factory
{
    private const CATALOG = [
        'IT' => [['Notebook', 'Dell', 'Latitude 7450'], ['Notebook', 'Lenovo', 'ThinkPad T14'], ['Monitor', 'LG', '27UP850'], ['Printer', 'HP', 'LaserJet M404']],
        'FURNITURE' => [['โต๊ะทำงาน', 'Modernform', 'WS-120'], ['เก้าอี้สำนักงาน', 'Ergotrend', 'Vertiback']],
        'VEHICLE' => [['รถยนต์ส่วนกลาง', 'Toyota', 'Camry'], ['รถกระบะ', 'Isuzu', 'D-Max']],
        'EQUIPMENT' => [['เครื่องปรับอากาศ', 'Daikin', 'FTKF18'], ['โปรเจกเตอร์', 'Epson', 'EB-X51']],
    ];

    public function definition(): array
    {
        $category = fake()->randomElement(array_keys(self::CATALOG));
        [$name, $brand, $model] = fake()->randomElement(self::CATALOG[$category]);
        $purchased = fake()->dateTimeBetween('-6 years', 'now');

        return [
            'asset_tag' => $category.'-'.$purchased->format('Y').'-'.fake()->unique()->numerify('######'),
            'name' => $name,
            'category' => $category,
            'brand' => $brand,
            'model' => $model,
            'serial_number' => strtoupper(fake()->bothify('SN##??####??')),
            'status' => fake()->randomElement([
                AssetStatus::Active, AssetStatus::Active, AssetStatus::Active,
                AssetStatus::InStorage, AssetStatus::InRepair, AssetStatus::Disposed,
            ]),
            'purchase_date' => $purchased,
            'purchase_cost' => fake()->randomFloat(2, 1500, 1500000),
            'warranty_expires_at' => (clone $purchased)->modify('+3 years'),
        ];
    }
}
