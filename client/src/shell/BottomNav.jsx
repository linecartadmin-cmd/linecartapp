import React from 'react';
import { MoreHorizontal, UserRound } from 'lucide-react';
import { Icon } from '../ui';

// Phone bottom bar: at most four destinations plus More (five targets in total).
export default function BottomNav({ items, page, onSelect, onMore, moreActive, moreIsAccountOnly, badges = {}, ariaLabel }) {
  return (
    <nav className="lc-bottomnav" aria-label={ariaLabel}>
      {items.slice(0, 4).map((item) => {
        const count = item.badge ? badges[item.badge] : null;
        return (
          <button
            key={item.pageId}
            type="button"
            className="lc-bottomnav__item"
            aria-current={page === item.pageId ? 'page' : undefined}
            onClick={() => onSelect(item)}
            aria-label={count ? `${item.label}, ${count} pending` : item.label}
          >
            <span className="lc-bottomnav__icon">
              <Icon icon={item.icon} size={24} />
              {count ? <span className="lc-count" aria-hidden="true">{count}</span> : null}
            </span>
            <span className="lc-bottomnav__label" aria-hidden="true">{item.short || item.label}</span>
          </button>
        );
      })}
      <button
        type="button"
        className="lc-bottomnav__item"
        aria-current={moreActive ? 'page' : undefined}
        aria-haspopup="dialog"
        onClick={onMore}
      >
        <span className="lc-bottomnav__icon">
          <Icon icon={moreIsAccountOnly ? UserRound : MoreHorizontal} size={24} />
        </span>
        <span className="lc-bottomnav__label">{moreIsAccountOnly ? 'Account' : 'More'}</span>
      </button>
    </nav>
  );
}
