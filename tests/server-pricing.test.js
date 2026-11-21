/**
 * PR-4: order prices and totals are resolved on the server; client-sent price fields are ignored.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { tokenFor, api, initTestDb, IDS } from './helpers/session.mjs';

let db;
let agentToken;
let basePrice;
const SHOP = 101;

function line(fields) {
  return { customerid: SHOP, itemid: 1, qty: 10, spersonid: IDS.agent1, clusterid: 1, ...fields };
}
async function placeOrder(lines, key = `price-${Date.now()}-${Math.random()}`) {
  return api('/createorder', { token: agentToken, method: 'POST', body: { idempotencyKey: key, orderList: lines } });
}

before(async () => {
  db = await initTestDb();
  agentToken = await tokenFor(IDS.agent1);
  await db.query("DELETE FROM cluster_item_prices WHERE cluster_id = 1 AND item_id IN (1, 2)");
  const r = await db.query('SELECT price FROM items WHERE item_id = 1');
  basePrice = Number(r.rows[0].price);
  assert.ok(basePrice > 1, 'item 1 has a catalog price');
});

after(async () => {
  await db.query("DELETE FROM cluster_item_prices WHERE id = 'cip-test-1-2'");
  await db.query('UPDATE items SET active = 1 WHERE item_id = 3');
});

describe('Server-authoritative order pricing', () => {
  test('tampered catalogPrice/price/actprice/custprice are ignored', async () => {
    const r = await placeOrder([line({ catalogPrice: 1, price: 1, actprice: 1, custprice: 1 })]);
    assert.strictEqual(r.status, 200, JSON.stringify(r.json));
    assert.strictEqual(r.json.orderTotal, Number((10 * basePrice).toFixed(2)));
    assert.strictEqual(r.json.priceApprovalPending, false);
    const rows = await db.query('SELECT price, cust_price, act_price FROM order_items WHERE order_id = $1', [r.json.orderId]);
    assert.strictEqual(Number(rows.rows[0].price), basePrice);
    assert.strictEqual(Number(rows.rows[0].act_price), basePrice);
    const order = await db.query('SELECT total, payment_balance_due, status FROM orders WHERE order_id = $1', [r.json.orderId]);
    assert.strictEqual(Number(order.rows[0].total), Number((10 * basePrice).toFixed(2)));
    assert.strictEqual(Number(order.rows[0].payment_balance_due), Number((10 * basePrice).toFixed(2)));
    assert.strictEqual(order.rows[0].status, 'In progress');
  });

  test('a requested price creates a pending request recorded against the SERVER catalog price', async () => {
    const r = await placeOrder([line({ requestedPrice: 1, catalogPrice: 1, price: 1 })]);
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.json.priceApprovalPending, true);
    assert.strictEqual(r.json.orderTotal, Number((10 * basePrice).toFixed(2)), 'total stays at catalog price until approval');
    const pr = await db.query('SELECT requested_price, catalog_price, status FROM price_requests WHERE order_id = $1', [r.json.orderId]);
    assert.strictEqual(pr.rowCount, 1);
    assert.strictEqual(Number(pr.rows[0].requested_price), 1);
    assert.strictEqual(Number(pr.rows[0].catalog_price), basePrice);
    assert.strictEqual(pr.rows[0].status, 'pending');
  });

  test('requesting exactly the catalog price is not a price request', async () => {
    const r = await placeOrder([line({ requestedPrice: basePrice })]);
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.json.priceApprovalPending, false);
  });

  test('cluster-specific daily price overrides the base price', async () => {
    const item2 = await db.query('SELECT price FROM items WHERE item_id = 2');
    const clusterPrice = Number(item2.rows[0].price) + 7.25;
    await db.query(
      `INSERT INTO cluster_item_prices (id, cluster_id, item_id, price, effective_date, updated_at, updated_by, updated_by_name)
       VALUES ('cip-test-1-2', 1, 2, $1, '2026-11-21', $2, 950, 'Test')`,
      [clusterPrice, new Date().toISOString()]
    );
    const r = await placeOrder([line({ itemid: 2, qty: 4, price: 999 })]);
    assert.strictEqual(r.status, 200, JSON.stringify(r.json));
    assert.strictEqual(r.json.orderTotal, Number((4 * clusterPrice).toFixed(2)));
  });

  test('unknown items are rejected with 400', async () => {
    const r = await placeOrder([line({ itemid: 99999, price: 10 })]);
    assert.strictEqual(r.status, 400);
    assert.match(r.json.message, /not available/);
  });

  test('archived items are rejected with 400', async () => {
    await db.query('UPDATE items SET active = 0 WHERE item_id = 3');
    const r = await placeOrder([line({ itemid: 3 })]);
    assert.strictEqual(r.status, 400);
  });

  test('invalid requested prices are rejected', async () => {
    for (const bad of ['12abc', -5]) {
      const r = await placeOrder([line({ requestedPrice: bad })]);
      assert.strictEqual(r.status, 400, `requestedPrice ${bad}`);
    }
  });

  test('zero-quantity lines are ignored and not stored', async () => {
    const r = await placeOrder([line({ qty: 5 }), line({ itemid: 2, qty: 0 })]);
    assert.strictEqual(r.status, 200);
    const rows = await db.query('SELECT item_id FROM order_items WHERE order_id = $1', [r.json.orderId]);
    assert.deepStrictEqual(rows.rows.map((x) => Number(x.item_id)), [1]);
  });

  test('line item names come from the catalog, not the client', async () => {
    const r = await placeOrder([line({ itemName: 'Gold Bars' })]);
    const rows = await db.query('SELECT item_name FROM order_items WHERE order_id = $1', [r.json.orderId]);
    assert.notStrictEqual(rows.rows[0].item_name, 'Gold Bars');
  });
});
