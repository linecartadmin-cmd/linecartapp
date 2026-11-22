import React from 'react';
import Icon from './Icon';

export function Card({ title, subtitle, actions, padded = true, as: Tag = 'section', className = '', children, ...rest }) {
  const headingId = title && rest.id ? `${rest.id}-title` : undefined;
  return (
    <Tag className={`lc-card ${padded ? 'lc-card--pad' : ''} ${className}`.trim()} aria-labelledby={headingId} {...rest}>
      {title || actions ? (
        <div className="lc-card__head">
          <div style={{ minWidth: 0 }}>
            {title ? <h2 className="lc-card__title" id={headingId}>{title}</h2> : null}
            {subtitle ? <p className="lc-card__sub">{subtitle}</p> : null}
          </div>
          {actions ? <div className="lc-cluster">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </Tag>
  );
}

// One row in a list. Renders a <button> when onClick is given, an <a> when href is given.
export function ListItem({ title, meta, leading, leadingIcon, trailing, onClick, href, className = '', ...rest }) {
  const content = (
    <>
      {leading || leadingIcon ? <span className="lc-li__lead">{leading || <Icon icon={leadingIcon} />}</span> : null}
      <span className="lc-li__body">
        <span className="lc-li__title">{title}</span>
        {meta ? <span className="lc-li__meta">{meta}</span> : null}
      </span>
      {trailing ? <span className="lc-li__trail">{trailing}</span> : null}
    </>
  );
  const cls = `lc-li ${className}`.trim();
  if (href) return <li><a className={cls} href={href} {...rest}>{content}</a></li>;
  if (onClick) return <li><button type="button" className={cls} onClick={onClick} {...rest}>{content}</button></li>;
  return <li className={cls} {...rest}>{content}</li>;
}

export function List({ label, className = '', children }) {
  return <ul className={`lc-list ${className}`.trim()} aria-label={label}>{children}</ul>;
}
