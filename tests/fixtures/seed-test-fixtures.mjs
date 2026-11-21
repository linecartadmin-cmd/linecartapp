/**
 * Test-only fixtures for the disposable test database.
 *
 * Several suites were written against a private data set (server/data.js, not in the repo).
 * This inserts the minimal records those suites rely on, so `npm test` works on a clean
 * checkout. It only runs inside the test runner (LINECART_TEST_MODE=1 + LOCAL_DB_PATH).
 */
export async function seedTestFixtures(db) {
  if (process.env.LINECART_TEST_MODE !== '1' || !process.env.LOCAL_DB_PATH) {
    throw new Error('seedTestFixtures may only run inside the test runner.');
  }

  // Field Sales Agent #4 on Manager 100's team (Agent 6 is a dev demo account and joins the team too)
  await db.query(
    `INSERT INTO users (id, name, role, phone, phone_valid, password_hash, must_change_password, cluster_id, active, created_on)
     VALUES (4, 'Test Agent Four', 'Field Sales Agent', '9876500004', 1, NULL, 0, 1, 1, '2026-04-01 09:00:00')
     ON CONFLICT (id) DO NOTHING`
  );
  for (const agentId of [4, 6]) {
    await db.query(
      'INSERT INTO manager_assignments (manager_id, agent_id) VALUES (100, $1) ON CONFLICT (manager_id, agent_id) DO NOTHING',
      [agentId]
    );
  }

  // Shops referenced by the shop-assignment suite (assigned to Agent 2, i.e. NOT to Agent 1)
  for (const shopId of [33, 34, 36, 40]) {
    await db.query(
      `INSERT INTO shops (shop_id, cluster_id, shop_name, shop_category, owner_name, contact1, contact2, latitude, longitude,
                          address, pincode, payment_mode, created_by, assigned_agent_id, photo, active, created_on, survey_json)
       VALUES ($1, 1, $2, 'Retail', 'Test Owner', '9876511111', '', 10.65, 77.0, 'Test Address', '642001', 0, 2, 2,
               'no_image.jpg', 1, '2026-04-01 10:00:00', '[]')
       ON CONFLICT (shop_id) DO NOTHING`,
      [shopId, `Test Shop ${shopId}`]
    );
  }

  // Baseline historical order kept across suites
  const existing = await db.query("SELECT order_id FROM orders WHERE order_id = 'S101-24019'");
  if (existing.rowCount === 0) {
    await db.query(
      `INSERT INTO orders (order_id, serial_no, shop_short_id, customer_id, customer_name, shop_category, sperson_id, agent_name,
                           cluster_id, order_date, expected_delivery_date, created_at, status, items_count, total,
                           delivery_agent_id, payment_status, payment_amount_collected, payment_balance_due)
       VALUES ('S101-24019', 24019, 'S101', 101, 'MS bakery', 'Retail', 1, 'Demo Agent', 1, '2026-10-20',
               '2026-10-21', '2026-10-20T05:00:00.000Z', 'Price approval pending', 1, 500, 50, 'Not collected', 0, 500)`
    );
    await db.query(
      `INSERT INTO order_items (id, order_id, item_id, item_name, qty, price, cust_price, act_price, requested_price, price_request_status, item_json)
       VALUES (1, 'S101-24019', 1, 'Onio Medium', 10, 50, 50, 50, 45, 'pending', $1)`,
      [JSON.stringify({ itemid: 1, itemName: 'Onio Medium', qty: 10, price: 50, unitType: 'Kgs', requestedPrice: 45, priceRequestStatus: 'pending' })]
    );
  }
}
