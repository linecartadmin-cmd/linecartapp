import { useEffect } from 'react';

// Pre-redesign screens render plain <table>s. On phones (below 768px) a wide table is hard to use,
// so each body cell gets a data-label copied from its column header and CSS (legacy-bridge.css,
// `.lc-rtable`) shows every row as a labelled card. Desktop and tablet keep the table.
//
// Tables are left as they are (horizontal scroll) when a header cell spans several columns or rows,
// when header and body cell counts do not line up, or when the screen already handles phones itself:
// the new DataTable (.lc-table), the Delivery screen (.dl-items), stacked order history
// (.responsive-stack-table), or anything marked data-lc-table="keep".

const SKIP = '.lc-table, .dl-items, .responsive-stack-table, [data-lc-table="keep"]';

export function labelTable(table) {
  if (!table || table.matches(SKIP) || table.closest('[data-lc-table="keep"]')) return false;
  const headRows = table.tHead ? table.tHead.rows : [];
  if (headRows.length !== 1) return false;
  const headers = [...headRows[0].cells];
  if (!headers.length || headers.some((th) => th.colSpan > 1 || th.rowSpan > 1)) return false;
  const labels = headers.map((th) => (th.textContent || '').replace(/\s+/g, ' ').trim());
  for (const body of table.tBodies) {
    for (const row of body.rows) {
      const cells = [...row.cells];
      // A single cell spanning the whole row is an empty-state or note row: show it as-is.
      if (cells.length === 1 && cells[0].colSpan > 1) {
        cells[0].setAttribute('data-full', '');
        continue;
      }
      if (cells.length !== labels.length || cells.some((c) => c.colSpan > 1)) return false;
      cells.forEach((td, i) => {
        if (labels[i]) td.setAttribute('data-label', labels[i]);
        else td.removeAttribute('data-label');
      });
    }
  }
  table.classList.add('lc-rtable');
  return true;
}

export function labelTablesIn(root) {
  if (!root) return 0;
  let n = 0;
  for (const t of root.querySelectorAll('table')) if (labelTable(t)) n += 1;
  return n;
}

export default function useResponsiveTables(rootSelector = '.lc-main .page-content') {
  useEffect(() => {
    if (typeof MutationObserver === 'undefined') return undefined;
    let frame = 0;
    const run = () => {
      frame = 0;
      document.querySelectorAll(rootSelector).forEach((root) => labelTablesIn(root));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(run);
    };
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });
    schedule();
    return () => {
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [rootSelector]);
}
