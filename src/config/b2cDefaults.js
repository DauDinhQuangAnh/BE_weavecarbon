const DEFAULT_B2C_COLLECTION_POINTS = [
  {
    id: '20b00000-0000-4000-8000-000000000001',
    name: 'WeaveCarbon Thu Duc Hub',
    address: '01 Vo Van Ngan',
    city: 'Ho Chi Minh City',
    district: 'Thu Duc',
    latitude: 10.8496217,
    longitude: 106.7712428,
    phone: '028-7100-1001',
    operating_hours: '08:30 - 18:00',
    accepts_charity: true,
    accepts_recycle: true,
    is_active: true
  },
  {
    id: '20b00000-0000-4000-8000-000000000002',
    name: 'WeaveCarbon District 7 Point',
    address: '102 Nguyen Thi Thap',
    city: 'Ho Chi Minh City',
    district: 'District 7',
    latitude: 10.7296141,
    longitude: 106.7063381,
    phone: '028-7100-1002',
    operating_hours: '09:00 - 19:00',
    accepts_charity: true,
    accepts_recycle: true,
    is_active: true
  },
  {
    id: '20b00000-0000-4000-8000-000000000003',
    name: 'WeaveCarbon Da Nang Center',
    address: '25 Tran Phu',
    city: 'Da Nang',
    district: 'Hai Chau',
    latitude: 16.0678406,
    longitude: 108.2208015,
    phone: '0236-710-1003',
    operating_hours: '08:00 - 17:30',
    accepts_charity: true,
    accepts_recycle: true,
    is_active: true
  },
  {
    id: '20b00000-0000-4000-8000-000000000004',
    name: 'WeaveCarbon Hanoi Recycling Hub',
    address: '18 Lang Ha',
    city: 'Hanoi',
    district: 'Dong Da',
    latitude: 21.0181208,
    longitude: 105.8144903,
    phone: '024-7100-1004',
    operating_hours: '08:30 - 18:00',
    accepts_charity: true,
    accepts_recycle: true,
    is_active: true
  }
];

const DEFAULT_B2C_MATERIAL_REWARDS = [
  {
    id: '10a00000-0000-4000-8000-000000000001',
    material_name: '100% Cotton',
    material_category: 'fabric',
    points_per_kg: 32,
    co2_saved_per_kg: 8.0,
    description: 'Default reward profile for cotton garments.',
    is_active: true
  },
  {
    id: '10a00000-0000-4000-8000-000000000002',
    material_name: 'Organic Cotton',
    material_category: 'fabric',
    points_per_kg: 18,
    co2_saved_per_kg: 4.5,
    description: 'Lower-carbon cotton with a reduced proxy footprint.',
    is_active: true
  },
  {
    id: '10a00000-0000-4000-8000-000000000003',
    material_name: 'Recycled Cotton',
    material_category: 'fabric',
    points_per_kg: 16,
    co2_saved_per_kg: 3.2,
    description: 'Reward profile for recycled cotton fabrics.',
    is_active: true
  },
  {
    id: '10a00000-0000-4000-8000-000000000004',
    material_name: '100% Polyester',
    material_category: 'fabric',
    points_per_kg: 24,
    co2_saved_per_kg: 5.5,
    description: 'Default reward profile for polyester garments.',
    is_active: true
  },
  {
    id: '10a00000-0000-4000-8000-000000000005',
    material_name: 'Recycled Polyester (rPET)',
    material_category: 'fabric',
    points_per_kg: 12,
    co2_saved_per_kg: 2.5,
    description: 'Reward profile for recycled polyester fabrics.',
    is_active: true
  },
  {
    id: '10a00000-0000-4000-8000-000000000006',
    material_name: '100% Wool',
    material_category: 'fabric',
    points_per_kg: 40,
    co2_saved_per_kg: 10.1,
    description: 'Default reward profile for wool garments.',
    is_active: true
  },
  {
    id: '10a00000-0000-4000-8000-000000000007',
    material_name: 'Merino Wool',
    material_category: 'fabric',
    points_per_kg: 44,
    co2_saved_per_kg: 11.5,
    description: 'Premium wool profile for merino garments.',
    is_active: true
  },
  {
    id: '10a00000-0000-4000-8000-000000000008',
    material_name: '100% Silk',
    material_category: 'fabric',
    points_per_kg: 30,
    co2_saved_per_kg: 7.5,
    description: 'Reward profile for silk fabrics.',
    is_active: true
  },
  {
    id: '10a00000-0000-4000-8000-000000000009',
    material_name: '100% Linen',
    material_category: 'fabric',
    points_per_kg: 20,
    co2_saved_per_kg: 5.2,
    description: 'Reward profile for linen fabrics.',
    is_active: true
  },
  {
    id: '10a00000-0000-4000-8000-000000000010',
    material_name: '100% Nylon',
    material_category: 'fabric',
    points_per_kg: 28,
    co2_saved_per_kg: 6.8,
    description: 'Reward profile for nylon fabrics.',
    is_active: true
  },
  {
    id: '10a00000-0000-4000-8000-000000000011',
    material_name: 'Recycled Nylon',
    material_category: 'fabric',
    points_per_kg: 14,
    co2_saved_per_kg: 3.5,
    description: 'Reward profile for recycled nylon fabrics.',
    is_active: true
  },
  {
    id: '10a00000-0000-4000-8000-000000000012',
    material_name: 'Bamboo Fabric',
    material_category: 'fabric',
    points_per_kg: 15,
    co2_saved_per_kg: 3.8,
    description: 'Reward profile for bamboo-based fabrics.',
    is_active: true
  },
  {
    id: '10a00000-0000-4000-8000-000000000013',
    material_name: 'Hemp Fabric',
    material_category: 'fabric',
    points_per_kg: 14,
    co2_saved_per_kg: 2.9,
    description: 'Reward profile for hemp-based fabrics.',
    is_active: true
  },
  {
    id: '10a00000-0000-4000-8000-000000000014',
    material_name: 'Tencel/Lyocell',
    material_category: 'fabric',
    points_per_kg: 16,
    co2_saved_per_kg: 3.5,
    description: 'Reward profile for Tencel and lyocell fabrics.',
    is_active: true
  },
  {
    id: '10a00000-0000-4000-8000-000000000015',
    material_name: 'Viscose/Rayon',
    material_category: 'fabric',
    points_per_kg: 17,
    co2_saved_per_kg: 4.2,
    description: 'Reward profile for viscose and rayon fabrics.',
    is_active: true
  },
  {
    id: '10a00000-0000-4000-8000-000000000016',
    material_name: 'Acrylic',
    material_category: 'fabric',
    points_per_kg: 20,
    co2_saved_per_kg: 5.0,
    description: 'Reward profile for acrylic fabrics.',
    is_active: true
  },
  {
    id: '10a00000-0000-4000-8000-000000000017',
    material_name: 'Genuine Leather',
    material_category: 'fabric',
    points_per_kg: 50,
    co2_saved_per_kg: 17.0,
    description: 'Reward profile for leather garments and accessories.',
    is_active: true
  },
  {
    id: '10a00000-0000-4000-8000-000000000018',
    material_name: 'Faux Leather/PU',
    material_category: 'fabric',
    points_per_kg: 28,
    co2_saved_per_kg: 7.0,
    description: 'Reward profile for faux leather and PU materials.',
    is_active: true
  },
  {
    id: '10a00000-0000-4000-8000-000000000019',
    material_name: 'Down Feather',
    material_category: 'fabric',
    points_per_kg: 48,
    co2_saved_per_kg: 15.0,
    description: 'Reward profile for down-filled products.',
    is_active: true
  },
  {
    id: '10a00000-0000-4000-8000-000000000020',
    material_name: 'Faux Fur',
    material_category: 'fabric',
    points_per_kg: 32,
    co2_saved_per_kg: 8.5,
    description: 'Reward profile for faux fur products.',
    is_active: true
  },
  {
    id: '10a00000-0000-4000-8000-000000000021',
    material_name: 'Cotton Canvas',
    material_category: 'fabric',
    points_per_kg: 34,
    co2_saved_per_kg: 9.0,
    description: 'Reward profile for cotton canvas products.',
    is_active: true
  },
  {
    id: '10a00000-0000-4000-8000-000000000022',
    material_name: 'Cotton/Polyester Blend',
    material_category: 'fabric',
    points_per_kg: 26,
    co2_saved_per_kg: 6.5,
    description: 'Reward profile for blended cotton and polyester fabrics.',
    is_active: true
  },
  {
    id: '10a00000-0000-4000-8000-000000000023',
    material_name: 'Wool/Polyester Blend',
    material_category: 'fabric',
    points_per_kg: 32,
    co2_saved_per_kg: 7.5,
    description: 'Reward profile for blended wool and polyester fabrics.',
    is_active: true
  },
  {
    id: '10a00000-0000-4000-8000-000000000024',
    material_name: 'Other Material (Proxy)',
    material_category: 'fabric',
    points_per_kg: 24,
    co2_saved_per_kg: 6.0,
    description: 'Fallback reward profile for user-defined materials.',
    is_active: true
  }
];

module.exports = {
  DEFAULT_B2C_COLLECTION_POINTS,
  DEFAULT_B2C_MATERIAL_REWARDS
};
