// LineCart Sanitized Demo Dataset (Safe for Public / Private Repository Sharing)
// All names, phone numbers, addresses, and coordinates are fictitious synthetic placeholders.

export const defaultSurveyItems = [
  { itemid: 1, itemName: "Onio Medium" },
  { itemid: 2, itemName: "Onion Big" },
  { itemid: 3, itemName: "Agra Potato" },
  { itemid: 4, itemName: "Local Potato (Thimbam/Kolar)" },
  { itemid: 5, itemName: "Tomato Hybrid" },
  { itemid: 6, itemName: "Tomato Nati" },
  { itemid: 7, itemName: "Coconut" },
  { itemid: 8, itemName: "Sambar Onion" }
];

export const defaultOrderItems = [
  {
    itemid: 1,
    itemName: "Onio Medium",
    itemimage: "onion_fresh.png",
    qty: 0.0,
    price: 53.0,
    cprice: 0.0,
    kgsperunit: 50,
    remarks: 0,
    unitType: "Kgs"
  },
  {
    itemid: 2,
    itemName: "Onion Big",
    itemimage: "onion_sambar.jpeg",
    qty: 0.0,
    price: 55.5,
    cprice: 0.0,
    kgsperunit: 50,
    remarks: 0,
    unitType: "Kgs"
  }
];

export const clusters = [
  {
    clusterId: 1,
    clusterName: "Pollachi and Udumalapet",
    surveyItemsList: [...defaultSurveyItems]
  },
  {
    clusterId: 2,
    clusterName: "Thuthukudi",
    surveyItemsList: [...defaultSurveyItems]
  }
];

export const salesPersons = [
  {
    id: 1,
    name: "Field Sales Agent 1",
    role: "Field Sales Agent",
    phone: "9876543210",
    password: "password123",
    clusterid: 1,
    active: 1,
    createdon: "2026-04-01 09:00:00"
  },
  {
    id: 2,
    name: "Field Sales Agent 2",
    role: "Field Sales Agent",
    phone: "9876543211",
    password: "password123",
    clusterid: 1,
    active: 1,
    createdon: "2026-04-01 09:00:00"
  },
  {
    id: 3,
    name: "Field Sales Agent 3",
    role: "Field Sales Agent",
    phone: "9876543212",
    password: "password123",
    clusterid: 2,
    active: 1,
    createdon: "2026-04-01 09:00:00"
  },
  {
    id: 100,
    name: "Regional Sales Manager",
    role: "Sales Manager",
    phone: "9876500001",
    password: "password123",
    clusterid: 1,
    active: 1,
    createdon: "2026-04-01 09:00:00"
  }
];

export const shops = [
  {
    shopid: 101,
    clusterid: 1,
    shopName: "Sunrise Fresh Produce",
    shopCategory: "Retail",
    ownerName: "Demo Owner A",
    contact1: "9800000001",
    contact2: "9800000002",
    latitude: 10.6583,
    longitude: 77.0082,
    address: "Market Road, Pollachi, Tamil Nadu, 642001",
    pincode: "642001",
    paymentmode: 0,
    createdby: 1,
    photo: "no_image.jpg",
    active: 1,
    createdon: "2026-10-12 10:00:00",
    survey: []
  },
  {
    shopid: 102,
    clusterid: 1,
    shopName: "Green Valley Mart",
    shopCategory: "SuperMarket",
    ownerName: "Demo Owner B",
    contact1: "9800000003",
    contact2: "",
    latitude: 10.6601,
    longitude: 77.0115,
    address: "Bazaar Street, Pollachi, Tamil Nadu, 642001",
    pincode: "642001",
    paymentmode: 1,
    createdby: 1,
    photo: "no_image.jpg",
    active: 1,
    createdon: "2026-10-12 11:30:00",
    survey: []
  },
  {
    shopid: 103,
    clusterid: 1,
    shopName: "Sri Krishna Bakery & Cafe",
    shopCategory: "HoReCa",
    ownerName: "Demo Owner C",
    contact1: "9800000004",
    contact2: "",
    latitude: 10.5751,
    longitude: 77.2530,
    address: "Udumalpet Main Road, Udumalaipettai, Tamil Nadu, 642126",
    pincode: "642126",
    paymentmode: 0,
    createdby: 2,
    photo: "no_image.jpg",
    active: 1,
    createdon: "2026-10-12 14:15:00",
    survey: []
  },
  {
    shopid: 104,
    clusterid: 1,
    shopName: "City Fresh Veggies",
    shopCategory: "Retail",
    ownerName: "Demo Owner D",
    contact1: "9800000005",
    contact2: "",
    latitude: 10.5820,
    longitude: 77.2450,
    address: "Gandhi Chowk, Udumalaipettai, Tamil Nadu, 642126",
    pincode: "642126",
    paymentmode: 1,
    createdby: 2,
    photo: "no_image.jpg",
    active: 1,
    createdon: "2026-10-12 16:40:00",
    survey: []
  },
  {
    shopid: 201,
    clusterid: 2,
    shopName: "Thuthukudi Harbor Fresh Mart",
    shopCategory: "SuperMarket",
    ownerName: "Demo Owner E",
    contact1: "9800000006",
    contact2: "9800000007",
    latitude: 8.7642,
    longitude: 78.1348,
    address: "WGC Road, Thuthukudi, Tamil Nadu, 628001",
    pincode: "628001",
    paymentmode: 1,
    createdby: 3,
    photo: "no_image.jpg",
    active: 1,
    createdon: "2026-10-13 09:20:00",
    survey: []
  },
  {
    shopid: 202,
    clusterid: 2,
    shopName: "Pearl City Produce",
    shopCategory: "Retail",
    ownerName: "Demo Owner F",
    contact1: "9800000008",
    contact2: "",
    latitude: 8.7900,
    longitude: 78.1400,
    address: "Beach Road, Thuthukudi, Tamil Nadu, 628001",
    pincode: "628001",
    paymentmode: 0,
    createdby: 3,
    photo: "no_image.jpg",
    active: 1,
    createdon: "2026-10-13 11:00:00",
    survey: []
  }
];

export const clusterStats = {
  1: {
    totalshops: 4,
    totalorderedshops: 2,
    totalnotorderedshops: 2,
    deliverystatus: [
      { id: 1, name: "Onio Medium", totalcount: 120 },
      { id: 2, name: "Onion Big", totalcount: 60 }
    ],
    order_item_status: [
      { id: 1, name: "Onio Medium", totalcount: 120 },
      { id: 2, name: "Onion Big", totalcount: 60 }
    ]
  },
  2: {
    totalshops: 2,
    totalorderedshops: 1,
    totalnotorderedshops: 1,
    deliverystatus: [
      { id: 1, name: "Onio Medium", totalcount: 80 },
      { id: 2, name: "Onion Big", totalcount: 40 }
    ],
    order_item_status: [
      { id: 1, name: "Onio Medium", totalcount: 80 },
      { id: 2, name: "Onion Big", totalcount: 40 }
    ]
  }
};

// ============================================================================
// DEMO FIXTURES ONLY (Not real data. For repository preview/offline testing only.)
// Real manager assignments & sales targets must be assigned by an Admin.
// ============================================================================
export const managerAssignments = {
  // Demonstration mapping: Manager 100 oversees Demo Agents 1 & 2
  100: [1, 2]
};

export const salesTargets = [
  // Demonstration quotas: Fictitious monthly targets for demo testing
  {
    id: 1,
    managerId: 100,
    agentId: 1,
    clusterId: 1,
    period: "2026-10",
    targetAmount: 25000,
    itemTargets: [
      { itemId: 1, itemName: "Onio Medium", targetQty: 250, price: 53.0, targetAmount: 13250 },
      { itemId: 2, itemName: "Onion Big", targetQty: 200, price: 55.5, targetAmount: 11100 }
    ]
  },
  {
    id: 2,
    managerId: 100,
    agentId: 2,
    clusterId: 1,
    period: "2026-10",
    targetAmount: 20000,
    itemTargets: [
      { itemId: 1, itemName: "Onio Medium", targetQty: 200, price: 53.0, targetAmount: 10600 },
      { itemId: 2, itemName: "Onion Big", targetQty: 150, price: 55.5, targetAmount: 8325 }
    ]
  }
];

export const submittedOrders = [
  {
    id: "S101-24018",
    orderId: "S101-24018",
    shopId: "S101",
    customerId: 101,
    customer: "Sunrise Fresh Produce",
    shopCategory: "Retail",
    spersonid: 1,
    agentName: "Field Sales Agent 1",
    clusterId: 1,
    date: "2026-10-24",
    createdAt: "2026-10-24T09:30:00.000Z",
    status: "In progress",
    itemsCount: 2,
    total: 4280,
    orderList: [
      { itemid: 1, itemName: "Onio Medium", qty: 40, actprice: 53.0, custprice: 53.0 },
      { itemid: 2, itemName: "Onion Big", qty: 30, actprice: 55.5, custprice: 55.5 }
    ]
  },
  {
    id: "S103-24017",
    orderId: "S103-24017",
    shopId: "S103",
    customerId: 103,
    customer: "Sri Krishna Bakery & Cafe",
    shopCategory: "HoReCa",
    spersonid: 2,
    agentName: "Field Sales Agent 2",
    clusterId: 1,
    date: "2026-10-23",
    createdAt: "2026-10-23T11:15:00.000Z",
    status: "Delivered",
    itemsCount: 2,
    total: 3150,
    orderList: [
      { itemid: 1, itemName: "Onio Medium", qty: 30, actprice: 53.0, custprice: 53.0 },
      { itemid: 2, itemName: "Onion Big", qty: 20, actprice: 55.5, custprice: 55.5 }
    ]
  }
];
