import React from 'react';
import { AlertCircle } from 'lucide-react';
import { EmptyState, Skeleton, SkeletonGroup } from './Display';
import { Button } from './Button';

/**
 * Table on tablet/desktop; on phones (< 600px) the same rows render as a list when
 * `cardTitle` is given, so no sideways scrolling is needed.
 *
 * columns: [{ key, header, render?(row), numeric?, width? }]
 * cardTitle(row), cardMeta?(row), cardTrailing?(row): phone list layout.
 * States: loading, error (+ onRetry), empty (emptyTitle / emptyText).
 */
export default function DataTable({
  columns,
  rows,
  rowKey = (r, i) => r.id ?? i,
  caption,
  loading = false,
  error = null,
  onRetry,
  emptyTitle = 'Nothing to show',
  emptyText,
  onRowClick,
  rowLabel,
  cardTitle,
  cardMeta,
  cardTrailing
}) {
  if (loading) {
    return (
      <SkeletonGroup label={caption ? `Loading ${caption}` : 'Loading'}>
        {[0, 1, 2, 3].map((i) => <Skeleton key={i} height={44} />)}
      </SkeletonGroup>
    );
  }
  if (error) {
    return (
      <EmptyState
        icon={AlertCircle}
        title="Could not load this list"
        action={onRetry ? <Button variant="secondary" onClick={onRetry}>Try again</Button> : null}
      >
        {typeof error === 'string' ? error : 'Check the connection and try again.'}
      </EmptyState>
    );
  }
  if (!rows || rows.length === 0) {
    return <EmptyState title={emptyTitle}>{emptyText}</EmptyState>;
  }
  const hasCards = typeof cardTitle === 'function';
  const keyActivate = (row) => (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onRowClick(row);
    }
  };
  return (
    <>
      <div className={`lc-table-wrap ${hasCards ? 'lc-table-wrap--cards' : ''}`.trim()}>
        <table className="lc-table">
          {caption ? <caption>{caption}</caption> : null}
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key} scope="col" className={c.numeric ? 'is-num' : undefined} style={c.width ? { width: c.width } : undefined}>
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr
                key={rowKey(row, i)}
                className={onRowClick ? 'is-clickable' : undefined}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                onKeyDown={onRowClick ? keyActivate(row) : undefined}
                tabIndex={onRowClick ? 0 : undefined}
                aria-label={onRowClick && rowLabel ? rowLabel(row) : undefined}
              >
                {columns.map((c) => (
                  <td key={c.key} className={c.numeric ? 'is-num' : undefined}>
                    {c.render ? c.render(row) : row[c.key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {hasCards ? (
        <ul className="lc-list lc-cards" aria-label={caption}>
          {rows.map((row, i) => {
            const body = (
              <>
                <span className="lc-li__body">
                  <span className="lc-li__title">{cardTitle(row)}</span>
                  {cardMeta ? <span className="lc-li__meta">{cardMeta(row)}</span> : null}
                </span>
                {cardTrailing ? <span className="lc-li__trail">{cardTrailing(row)}</span> : null}
              </>
            );
            return (
              <li key={rowKey(row, i)}>
                {onRowClick ? (
                  <button type="button" className="lc-li" onClick={() => onRowClick(row)}>{body}</button>
                ) : (
                  <div className="lc-li">{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
    </>
  );
}

export function FilterBar({ search, children, onClear, clearDisabled, label = 'Filters' }) {
  return (
    <div className="lc-filterbar" role="search" aria-label={label}>
      {search ? <div className="lc-filterbar__search">{search}</div> : null}
      {React.Children.map(children, (child) => (child ? <div className="lc-filterbar__item">{child}</div> : null))}
      {onClear ? (
        <div className="lc-filterbar__actions">
          <Button variant="ghost" size="sm" onClick={onClear} disabled={clearDisabled}>Clear filters</Button>
        </div>
      ) : null}
    </div>
  );
}

