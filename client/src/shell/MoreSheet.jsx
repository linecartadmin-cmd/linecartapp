import React from 'react';
import { LogOut } from 'lucide-react';
import { BottomSheet, List, ListItem, Button } from '../ui';
import { initials } from './ProfileMenu';

// Phone "More" sheet: destinations that do not fit the bottom bar, then the profile and sign out.
export default function MoreSheet({ open, onClose, groups, page, onSelect, user, roleLabel, onSignOut, badges = {} }) {
  return (
    <BottomSheet open={open} onClose={onClose} title={groups.length ? 'More' : 'Account'}>
      <div className="lc-more">
        {groups.map((g, gi) => (
          <div className="lc-more__group" key={g.label || `g${gi}`}>
            {g.label ? <h3 className="lc-more__label">{g.label}</h3> : null}
            <List label={g.label || 'Pages'}>
              {g.items.map((item) => {
                const count = item.badge ? badges[item.badge] : null;
                return (
                  <ListItem
                    key={item.pageId}
                    leadingIcon={item.icon}
                    title={item.label}
                    aria-current={page === item.pageId ? 'page' : undefined}
                    trailing={count ? <span className="lc-count">{count}</span> : null}
                    onClick={() => {
                      onClose();
                      onSelect(item);
                    }}
                  />
                );
              })}
            </List>
          </div>
        ))}
        <div className="lc-more__group">
          <h3 className="lc-more__label">Signed in as</h3>
          <div className="lc-more__profile">
            <span className="lc-avatar" aria-hidden="true">{initials(user?.name)}</span>
            <span style={{ minWidth: 0 }}>
              <b>{user?.name}</b>
              <small>{roleLabel}</small>
            </span>
          </div>
          <Button
            variant="danger-ghost"
            icon={LogOut}
            block
            onClick={() => {
              onClose();
              onSignOut();
            }}
          >
            Sign out
          </Button>
        </div>
      </div>
    </BottomSheet>
  );
}
