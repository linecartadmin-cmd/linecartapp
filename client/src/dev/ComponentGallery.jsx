// DEVELOPMENT ONLY. Loaded from main.jsx behind import.meta.env.DEV, so production builds
// contain none of this file. Open the Vite dev server at /#dev-gallery.
// All data below is sample data for checking the components, not business data.
import React, { useState } from 'react';
import { Truck, Phone, Navigation, Plus, Store, Trash2, Filter, Package } from 'lucide-react';
import {
  Button,
  IconButton,
  Icon,
  Field,
  TextInput,
  SearchInput,
  Select,
  TextArea,
  QuantityStepper,
  SegmentedControl,
  Card,
  List,
  ListItem,
  StatusPill,
  Dialog,
  ConfirmDialog,
  BottomSheet,
  useToast,
  EmptyState,
  Skeleton,
  SkeletonGroup,
  Metric,
  ProgressBar,
  DataTable,
  FilterBar
} from '../ui';

const LONG_SHOP = 'Sri Murugan Vegetables and Fruits Wholesale Commission Agency, Gandhi Market Back Gate';
const TAMIL = 'டெலிவரி செய்யப்பட்டது';

const SAMPLE_ROWS = [
  { id: 'SAMPLE-1', shop: 'Sample Fresh Produce', status: 'Delivered', pay: 'Collected', total: 1362.5 },
  { id: 'SAMPLE-2', shop: LONG_SHOP, status: 'Price approval pending', pay: 'Not collected', total: 18450 },
  { id: 'SAMPLE-3', shop: 'Sample Mart', status: 'Picked up', pay: 'Partially collected', total: 6200 }
];

function Section({ title, children }) {
  return (
    <Card title={title} as="section">
      <div className="lc-stack">{children}</div>
    </Card>
  );
}

export default function ComponentGallery() {
  const toast = useToast();
  const [qty, setQty] = useState(25);
  const [range, setRange] = useState('today');
  const [dialog, setDialog] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [phone, setPhone] = useState('98700');
  const [tableState, setTableState] = useState('rows');
  const rupee = (n) => `₹${Number(n).toLocaleString('en-IN')}`;

  return (
    <div style={{ background: 'var(--lc-bg)', minHeight: '100vh', paddingBlock: 24 }}>
      <div className="lc-container lc-stack lc-stack--lg">
        <header className="lc-stack lc-stack--sm">
          <span className="lc-pill lc-pill--warning" style={{ justifySelf: 'start', width: 'fit-content' }}>Development build only</span>
          <h1 style={{ margin: 0, font: '800 28px/1.2 var(--lc-font-head)', color: 'var(--lc-ink)' }}>LineCart UI primitives</h1>
          <p style={{ margin: 0, color: 'var(--lc-muted)' }}>Sample data only. This page is excluded from production builds.</p>
        </header>

        <Section title="Buttons">
          <div className="lc-cluster">
            <Button icon={Plus}>Place order</Button>
            <Button variant="secondary">Cancel</Button>
            <Button variant="ghost">View history</Button>
            <Button variant="danger" icon={Trash2}>Delete order</Button>
            <Button variant="danger-ghost">Could not deliver</Button>
            <Button variant="success">Mark delivered</Button>
            <Button disabled>Disabled</Button>
            <Button loading>Saving</Button>
          </div>
          <div className="lc-cluster">
            <Button size="sm">Small 36</Button>
            <Button>Default 44</Button>
            <Button size="lg" icon={Truck}>Field action 56</Button>
            <IconButton icon={Phone} label="Call shop" outlined />
            <IconButton icon={Navigation} label="Navigate" outlined />
            <IconButton icon={Filter} label="Filters" badge={3} />
          </div>
          <div style={{ maxWidth: 360 }} className="lc-stack lc-stack--sm">
            <Button size="lg" variant="success" block className="lc-tamil">{TAMIL}</Button>
            <Button block variant="secondary">{LONG_SHOP}</Button>
          </div>
        </Section>

        <Section title="Form controls">
          <div className="lc-grid lc-grid--2">
            <Field label="Shop" required help="Only shops assigned to you are listed.">
              <Select options={[{ value: '', label: 'Select a shop' }, { value: '1', label: LONG_SHOP }]} defaultValue="" />
            </Field>
            <Field label="Mobile number" error={/^[6-9]\d{9}$/.test(phone) ? null : 'Enter 10 digits starting with 6, 7, 8 or 9.'}>
              <TextInput type="tel" inputMode="numeric" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </Field>
            <Field label="Search items">
              <SearchInput placeholder="Onion, tomato…" />
            </Field>
            <Field label="Notes" help="Optional delivery instructions.">
              <TextArea />
            </Field>
            <Field label="Disabled field">
              <TextInput value="Set by the server" disabled readOnly />
            </Field>
            <div className="lc-stack lc-stack--sm">
              <span className="lc-field__label">Quantity (kg)</span>
              <QuantityStepper value={qty} onChange={setQty} unit="kg" min={0} step={5} />
            </div>
          </div>
          <SegmentedControl
            label="Date range"
            value={range}
            onChange={setRange}
            options={[{ value: 'today', label: 'Today' }, { value: '7d', label: '7 days' }, { value: 'month', label: 'This month' }]}
          />
        </Section>

        <Section title="Status pills">
          <div className="lc-cluster">
            {['Pending', 'In progress', 'Price approval pending', 'Picked up', 'Delivered', 'Could not deliver', 'Cancelled', 'Collected', 'Partially collected', 'Not collected', 'verified', 'too_far', 'poor_accuracy'].map((s) => (
              <StatusPill key={s} status={s} />
            ))}
            <StatusPill status="Delivered" label={TAMIL} className="lc-tamil" />
          </div>
        </Section>

        <Section title="Cards, lists, metrics, progress">
          <div className="lc-grid lc-grid--4">
            <Metric label="Sample metric" value={rupee(18450)} hint="Shows exactly the value given" />
            <Metric label="Orders (sample)" value="6" />
            <Metric label="Loading" loading />
            <Metric label="Missing value" value={null} hint="Renders a dash, never a made-up number" />
          </div>
          <ProgressBar label="Visits verified (sample)" value={9} max={22} valueText="9 of 22" />
          <ProgressBar label="Target (sample)" value={38} tone="warning" />
          <List label="Sample stops">
            <ListItem leadingIcon={Store} title={LONG_SHOP} meta="Order SAMPLE-2 · 9 items" trailing={<StatusPill status="Picked up" />} onClick={() => toast.show('Opened a sample stop')} />
            <ListItem leadingIcon={Store} title="Sample Fresh Produce" meta="No GPS · address only" trailing={<StatusPill status="Price approval pending" />} />
            <ListItem leadingIcon={Package} title={<span className="lc-tamil">{TAMIL}</span>} meta="Tamil label check" />
          </List>
        </Section>

        <Section title="Data table (resize below 600px for the list layout)">
          <SegmentedControl
            label="Table state"
            value={tableState}
            onChange={setTableState}
            options={[{ value: 'rows', label: 'Rows' }, { value: 'loading', label: 'Loading' }, { value: 'empty', label: 'Empty' }, { value: 'error', label: 'Error' }]}
          />
          <FilterBar search={<SearchInput placeholder="Search shop or order" />} onClear={() => {}} clearDisabled>
            <Field label="Status"><Select options={[{ value: '', label: 'All statuses' }]} /></Field>
          </FilterBar>
          <DataTable
            caption="Sample orders"
            loading={tableState === 'loading'}
            error={tableState === 'error' ? 'The server did not answer.' : null}
            onRetry={() => setTableState('rows')}
            rows={tableState === 'empty' ? [] : SAMPLE_ROWS}
            emptyTitle="No orders match"
            emptyText="Change the filters to see more orders."
            onRowClick={(r) => toast.show(`Opened ${r.id}`)}
            rowLabel={(r) => `Open order ${r.id}`}
            columns={[
              { key: 'id', header: 'Order' },
              { key: 'shop', header: 'Shop' },
              { key: 'status', header: 'Status', render: (r) => <StatusPill status={r.status} /> },
              { key: 'pay', header: 'Payment', render: (r) => <StatusPill status={r.pay} /> },
              { key: 'total', header: 'Total', numeric: true, render: (r) => rupee(r.total) }
            ]}
            cardTitle={(r) => r.shop}
            cardMeta={(r) => `${r.id} · ${rupee(r.total)}`}
            cardTrailing={(r) => <StatusPill status={r.status} />}
          />
        </Section>

        <Section title="Empty state and skeleton">
          <div className="lc-grid lc-grid--2">
            <Card padded={false}><EmptyState icon={Truck} title="No deliveries assigned" action={<Button variant="secondary">Refresh</Button>}>New stops appear here when an admin assigns them to you.</EmptyState></Card>
            <Card>
              <SkeletonGroup label="Loading sample">
                <Skeleton height={20} width="40%" />
                <Skeleton height={56} />
                <Skeleton height={56} />
              </SkeletonGroup>
            </Card>
          </div>
        </Section>

        <Section title="Dialogs, sheet and toasts">
          <div className="lc-cluster">
            <Button variant="secondary" onClick={() => setDialog(true)}>Open dialog</Button>
            <Button variant="danger" onClick={() => setConfirm(true)}>Open confirm</Button>
            <Button variant="secondary" onClick={() => setSheet(true)}>Open bottom sheet</Button>
          </div>
          <div className="lc-cluster">
            <Button size="sm" variant="secondary" onClick={() => toast.show('Order updated successfully.')}>Success toast</Button>
            <Button size="sm" variant="secondary" onClick={() => toast.show('Failed to update order status. Please retry.')}>Error toast (stays)</Button>
            <Button size="sm" variant="secondary" onClick={() => toast.show('1 update will be sent when you are back online.')}>Warning toast</Button>
            <Button size="sm" variant="secondary" onClick={() => toast.show('Refreshing stops', 'info')}>Info toast</Button>
            <Button size="sm" variant="secondary" onClick={() => ['First', 'Second', 'Third', 'Fourth (queued)', 'Fifth (queued)'].forEach((m) => toast.show(`${m} message`, 'info'))}>Queue five</Button>
          </div>
        </Section>
      </div>

      <Dialog open={dialog} onClose={() => setDialog(false)} title="Sample dialog" footer={<><Button variant="secondary" onClick={() => setDialog(false)}>Close</Button><Button onClick={() => setDialog(false)}>Save</Button></>}>
        <div className="lc-stack">
          <p style={{ margin: 0 }}>Focus is trapped here. Escape, the close button or a click on the backdrop closes it.</p>
          <Field label="Sample input"><TextInput /></Field>
        </div>
      </Dialog>
      <ConfirmDialog
        open={confirm}
        tone="danger"
        title="Delete sample order?"
        message="This only closes the sample dialog. Cancel has focus first."
        confirmLabel="Delete"
        onCancel={() => setConfirm(false)}
        onConfirm={() => new Promise((r) => setTimeout(r, 800)).then(() => { setConfirm(false); toast.show('Sample deleted', 'success'); })}
      />
      <BottomSheet open={sheet} onClose={() => setSheet(false)} title="More">
        <List label="Sample links">
          <ListItem leadingIcon={Store} title="Shops" onClick={() => setSheet(false)} />
          <ListItem leadingIcon={Truck} title="Deliveries" onClick={() => setSheet(false)} />
        </List>
      </BottomSheet>
    </div>
  );
}
