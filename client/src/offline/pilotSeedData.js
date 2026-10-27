/**
 * LineCart Safe Synthetic Pilot Seed Dataset
 *
 * Used for offline-first bootstrapping on install/first launch.
 *
 * SECURITY & PRIVACY NOTICE:
 * Shop and customer information bundled in an APK can be extracted by decompiling
 * the APK assets or inspecting IndexedDB storage on rooted or compromised Android devices.
 * Real customer personal data (PII, phone numbers, addresses, personal identities)
 * must NEVER be hardcoded into distributable APK bundles.
 *
 * The dataset below contains only fictitious synthetic placeholders for offline testing
 * and demonstration. Real customer records are strictly populated via authenticated
 * server synchronization over HTTPS.
 */

export const PILOT_CLUSTERS = [
  {
    clusterId: 1,
    clusterid: 1,
    clusterName: 'Pollachi and Udumalapet'
  },
  {
    clusterId: 2,
    clusterid: 2,
    clusterName: 'Thuthukudi'
  }
];

export const PILOT_CATALOG = [
  {
    itemId: 1,
    itemid: 1,
    itemName: 'Onio Medium',
    price: 53.0,
    cprice: 0.0,
    unitType: 'Kgs',
    kgsPerUnit: 50
  },
  {
    itemId: 2,
    itemid: 2,
    itemName: 'Onion Big',
    price: 55.5,
    cprice: 0.0,
    unitType: 'Kgs',
    kgsPerUnit: 50
  },
  {
    itemId: 3,
    itemid: 3,
    itemName: 'Agra Potato',
    price: 32.0,
    cprice: 0.0,
    unitType: 'Kgs',
    kgsPerUnit: 50
  },
  {
    itemId: 4,
    itemid: 4,
    itemName: 'Tomato Hybrid',
    price: 28.0,
    cprice: 0.0,
    unitType: 'Kgs',
    kgsPerUnit: 25
  },
  {
    itemId: 5,
    itemid: 5,
    itemName: 'Coconut',
    price: 35.0,
    cprice: 0.0,
    unitType: 'Pieces',
    kgsPerUnit: 1
  }
];

export const PILOT_SHOPS = [
  {
    shopid: 101,
    clusterid: 1,
    shopName: 'Sunrise Fresh Produce (Pilot)',
    shopCategory: 'Retail',
    ownerName: 'Pilot Partner A',
    contact1: '9876543201',
    address: 'Market Yard Road, Pollachi',
    pincode: '642001'
  },
  {
    shopid: 102,
    clusterid: 1,
    shopName: 'Green Valley Grocers (Pilot)',
    shopCategory: 'Supermarket',
    ownerName: 'Pilot Partner B',
    contact1: '9876543202',
    address: 'Bus Stand Circle, Udumalapet',
    pincode: '642126'
  },
  {
    shopid: 103,
    clusterid: 2,
    shopName: 'Coastal Harvest Store (Pilot)',
    shopCategory: 'Wholesale',
    ownerName: 'Pilot Partner C',
    contact1: '9876543203',
    address: 'Port Trust Road, Thuthukudi',
    pincode: '628001'
  }
];

export const PILOT_SEED_DATA = {
  clusters: PILOT_CLUSTERS,
  items: PILOT_CATALOG,
  shops: PILOT_SHOPS,
  dailyPrices: PILOT_CATALOG.map((item) => ({
    itemId: item.itemId,
    clusterId: 1,
    price: item.price
  }))
};
