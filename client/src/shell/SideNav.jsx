import React from 'react';
import { Icon } from '../ui';

// Desktop grouped sidebar; the same markup becomes the icon rail on tablets (CSS only).
export default function SideNav({ groups, page, onSelect, homePage, badges = {}, ariaLabel }) {
  return (
    <aside className="lc-sidenav">
      <a
        className="lc-brand"
        href={`#${homePage}`}
        onClick={(e) => {
          e.preventDefault();
          onSelect({ pageId: homePage });
        }}
        aria-label="LineCart home"
      >
        <img src="/lincart_flashicon.png" alt="" />
        <span className="lc-brand__text">
          linecart<span className="lc-brand__dot">.</span>
        </span>
      </a>
      <nav aria-label={ariaLabel}>
        {groups.map((g, gi) => (
          <div className="lc-nav-group" key={g.label || `g${gi}`} role="group" aria-label={g.label || undefined}>
            {g.label ? <div className="lc-nav-group__label" aria-hidden="true">{g.label}</div> : null}
            {g.items.map((item) => {
              const count = item.badge ? badges[item.badge] : null;
              return (
                <button
                  key={item.pageId}
                  type="button"
                  className="lc-nav-item"
                  aria-current={page === item.pageId ? 'page' : undefined}
                  title={item.label}
                  onClick={() => onSelect(item)}
                >
                  <Icon icon={item.icon} size={20} />
                  <span className="lc-nav-item__label">{item.label}</span>
                  <span className="lc-nav-item__short" aria-hidden="true">{item.short || item.label}</span>
                  {count ? (
                    <span className="lc-count" aria-label={`${count} pending`}>{count}</span>
                  ) : null}
                </button>
              );
            })}
          </div>
        ))}
      </nav>
    </aside>
  );
}
