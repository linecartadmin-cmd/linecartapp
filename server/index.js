import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  salesPersons,
  clusters,
  defaultOrderItems,
  shops,
  clusterStats,
  submittedOrders
} from './data.loader.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = 3001;
const upload = multer({ storage: multer.memoryStorage() });

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Normalize full proxy URLs if used as Android HTTP proxy for http://freshcubes.in
app.use((req, res, next) => {
  if (req.url.startsWith('http://freshcubes.in')) {
    req.url = req.url.replace('http://freshcubes.in', '');
  }
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// Serve static item images at both local /items and APK's /admin_panel/storage/app/public/LC_customer/items
const itemsDir = path.join(__dirname, '../client/public/items');
app.use('/items', express.static(itemsDir));
app.use('/admin_panel/storage/app/public/LC_customer/items', express.static(itemsDir));

// Serve static frontend build
const clientDist = path.join(__dirname, '../client/dist');
app.use(express.static(clientDist));

// Demo users helper endpoint for the website Login screen
app.get('/api/demo-users', (req, res) => {
  res.json({
    status: 200,
    users: salesPersons
  });
});

// 1. POST login (@POST("login") with @Query("phone") & @Query("password"))
// APK Login$onCreate$1$1 checks: status == 200, saves result[0].id to SharedPreferences("LineCartPref")."userid"
const handleLogin = (req, res) => {
  const phone = String(req.query.phone || req.body?.phone || '').trim();
  const password = String(req.query.password || req.body?.password || '').trim();

  const found = salesPersons.find(
    (s) =>
      (s.phone === phone ||
        String(s.id) === phone ||
        s.name.toLowerCase() === phone.toLowerCase()) &&
      (s.password === password || password === '1234' || password === 'password123')
  );

  if (found) {
    return res.json({
      status: 200,
      message: 'Login successful',
      result: [found]
    });
  }

  // Also allow any 10-digit phone in demo mode if password === 'demo123'
  if (phone.length === 10 && password === 'demo123') {
    return res.json({
      status: 200,
      message: 'Login successful',
      result: [salesPersons[0]]
    });
  }

  return res.json({
    status: 400,
    message: 'Invalid UserId/Password.',
    result: []
  });
};

app.post('/login', handleLogin);
app.post('/api/linecart/login', handleLogin);
app.post('/admin_panel/public/api/linecart/login', handleLogin);

// 2. GET gethomereport (@GET("gethomereport") with @Query("spersonId"))
// APK HomeReport$loadclusters$1 checks: status == 200, reads result.clusterList
const handleGetHomeReport = (req, res) => {
  const spersonId = String(req.query.spersonId || req.query.salespersonid || '6');

  const clusterList = clusters.map((cluster) => {
    const stats = clusterStats[cluster.clusterId] || {
      totalshops: 0,
      totalorderedshops: 0,
      totalnotorderedshops: 0,
      deliverystatus: [],
      order_item_status: []
    };
    return {
      clusterId: cluster.clusterId,
      clusterName: cluster.clusterName,
      deliverystatus: stats.deliverystatus,
      order_shop_status: {
        totalshops: stats.totalshops,
        totalorderedshops: stats.totalorderedshops,
        totalnotorderedshops: stats.totalnotorderedshops
      },
      order_item_status: stats.order_item_status
    };
  });

  res.json({
    status: 200,
    message: 'Data Received Successfully.',
    result: {
      status: 200,
      message: 'Details',
      salesPersonId: spersonId,
      clusterList
    }
  });
};

app.get('/gethomereport', handleGetHomeReport);
app.get('/api/linecart/gethomereport', handleGetHomeReport);
app.get('/admin_panel/public/api/linecart/gethomereport', handleGetHomeReport);

// 3. GET clusterinfo (@GET("clusterinfo") with @Query("spersonId"))
// APK Registration$loadclusters$1 checks: status == 200, reads result.clusterList[i].surveyItemsList
const handleClusterInfo = (req, res) => {
  const spersonId = String(req.query.spersonId || req.query.salespersonid || '6');

  res.json({
    status: 200,
    message: 'Data Received Successfully.',
    result: {
      salesPersonId: spersonId,
      clusterList: clusters
    }
  });
};

app.get('/clusterinfo', handleClusterInfo);
app.get('/api/linecart/clusterinfo', handleClusterInfo);
app.get('/admin_panel/public/api/linecart/clusterinfo', handleClusterInfo);

// 4. POST addcustomer (@POST("addcustomer") @Multipart: @Part file ("image"), @Part("customer") RequestBody)
// APK Registration$submitbtnclicked$1 checks: status == 200 -> Toast "Customer Created Successfully"
const handleAddCustomer = (req, res) => {
  try {
    let customerData = {};
    if (req.body && req.body.customer) {
      customerData =
        typeof req.body.customer === 'string'
          ? JSON.parse(req.body.customer)
          : req.body.customer;
    } else if (req.body) {
      customerData = req.body;
    }

    const clusterid = parseInt(customerData.clusterid, 10) || 1;
    const newShopId = shops.reduce((max, s) => Math.max(max, s.shopid), 400) + 1;

    const newShop = {
      shopid: newShopId,
      clusterid,
      shopName: customerData.shopName || '',
      shopCategory: customerData.shopCategory || 'Vegitable Shop',
      ownerName: customerData.ownerName || '',
      contact1: customerData.contact1 || '',
      contact2: customerData.contact2 || '',
      latitude: parseFloat(customerData.latitude) || 0,
      longitude: parseFloat(customerData.longitude) || 0,
      address: customerData.address || '',
      pincode: customerData.pincode || '',
      paymentmode: parseInt(customerData.paymentmode, 10) || 0,
      createdby: parseInt(customerData.createdby, 10) || 6,
      survey: Array.isArray(customerData.survey) ? customerData.survey : []
    };

    shops.push(newShop);
    if (clusterStats[clusterid]) {
      clusterStats[clusterid].totalshops += 1;
      clusterStats[clusterid].totalnotorderedshops += 1;
    }

    res.json({
      status: 200,
      message: 'Customer Created Successfully',
      id: String(newShopId)
    });
  } catch (err) {
    res.status(400).json({
      status: 400,
      message: 'Failed To Create Customer',
      id: '0'
    });
  }
};

app.post('/addcustomer', upload.any(), handleAddCustomer);
app.post('/api/linecart/addcustomer', upload.any(), handleAddCustomer);
app.post('/admin_panel/public/api/linecart/addcustomer', upload.any(), handleAddCustomer);

// 5. GET getitemsorder (@GET("getitemsorder") with @Query("spersonId"))
// APK OrderRequest$onViewCreated$2 checks: status == 200, reads result.clusterList[i].shopsList[j].itemsList
const handleGetItemsOrder = (req, res) => {
  const spersonId = String(req.query.spersonId || req.query.salespersonid || '6');

  const clusterList = clusters.map((cluster) => {
    const clusterShops = shops
      .filter((s) => s.clusterid === cluster.clusterId)
      .map((shop) => ({
        ...shop,
        itemsList: defaultOrderItems.map((item) => ({ ...item }))
      }));

    return {
      clusterId: cluster.clusterId,
      clusterName: cluster.clusterName,
      shopsList: clusterShops
    };
  });

  res.json({
    status: 200,
    message: 'Data Received Successfully.',
    result: {
      status: 200,
      message: 'Details',
      salesPersonId: spersonId,
      clusterList
    }
  });
};

app.get('/getitemsorder', handleGetItemsOrder);
app.get('/api/linecart/getitemsorder', handleGetItemsOrder);
app.get('/admin_panel/public/api/linecart/getitemsorder', handleGetItemsOrder);

// 6. POST createorder (@POST("createorder") with @Body CreateOrderReq { orderList: [OrderReq] })
// APK OrderRequest$createOrder$1 checks: status == 200 -> Toast "Order Created Successfully"
const handleCreateOrder = (req, res) => {
  try {
    const orderList = Array.isArray(req.body?.orderList) ? req.body.orderList : [];
    const customerId = orderList[0]?.customerid;
    const shop = shops.find((s) => Number(s.shopid) === Number(customerId));
    const shopShortId = shop
      ? `S${String(shop.shopid).padStart(3, '0')}`
      : 'S000';

    const baseSerial = 24018 + submittedOrders.length + 1;
    const newOrderId = `${shopShortId}-${baseSerial}`;

    submittedOrders.push({
      id: newOrderId,
      orderId: newOrderId,
      shopId: shopShortId,
      customerId,
      createdAt: new Date().toISOString(),
      orderList
    });

    // Update HomeReport stats for this cluster if any item has qty > 0
    const clusterid = parseInt(orderList[0]?.clusterid, 10) || (shop?.clusterid || 1);
    const stats = clusterStats[clusterid];
    if (stats) {
      let anyOrdered = false;
      for (const ord of orderList) {
        const qty = parseFloat(ord.qty) || 0;
        if (qty > 0) {
          anyOrdered = true;
          const itemStat = stats.order_item_status.find((i) => Number(i.id) === Number(ord.itemid));
          if (itemStat) itemStat.totalcount += Math.round(qty);
          const delvStat = stats.deliverystatus.find((i) => Number(i.id) === Number(ord.itemid));
          if (delvStat) delvStat.totalcount += Math.round(qty);
        }
      }
      if (anyOrdered) {
        stats.totalorderedshops += 1;
        if (stats.totalnotorderedshops > 0) {
          stats.totalnotorderedshops -= 1;
        }
      }
    }

    res.json({
      status: 200,
      message: 'Order Created Successfully',
      id: String(baseSerial),
      orderId: newOrderId,
      shopId: shopShortId
    });
  } catch (err) {
    res.status(400).json({
      status: 400,
      message: 'Failed to create Order.',
      id: '0'
    });
  }
};

app.post('/createorder', handleCreateOrder);
app.post('/api/linecart/createorder', handleCreateOrder);
app.post('/admin_panel/public/api/linecart/createorder', handleCreateOrder);

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(clientDist, 'index.html'));
});

app.listen(port, '0.0.0.0', () => {
  console.log(`LineCart Server running on http://localhost:${port}`);
});
