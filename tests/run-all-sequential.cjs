const { execSync } = require('child_process');

const testFiles = [
  'focused-verification.test.js',
  'items-daily-pricing.test.js',
  'order-history-and-summary-report.test.js',
  'offline-and-price-approvals.test.js',
  'shop-assignment-and-agent-flow.test.js',
  'payment-collection-tracking.test.js',
  'price-approval-and-7day-history.test.js'
];

async function cleanupDb() {
  const m = await import('../server/db.js');
  await m.db.init();
  await m.db.query("DELETE FROM price_requests WHERE order_id NOT IN ('S101-24019')");
  await m.db.query("DELETE FROM order_items WHERE order_id NOT IN ('S101-24019')");
  await m.db.query("DELETE FROM orders WHERE order_id NOT IN ('S101-24019')");
  await m.db.close();
}

async function run() {
  for (const f of testFiles) {
    console.log(`\n========================================\nRUNNING: ${f}\n========================================`);
    try {
      execSync(`node --test linecart-suite/tests/${f}`, { stdio: 'inherit' });
      console.log(`PASS: ${f}`);
    } finally {
      await cleanupDb();
    }
  }
  console.log('\nALL TEST SUITES PASSED SUCCESSFULLY!');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
