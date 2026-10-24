import { useId, useMemo, useRef, useState } from 'react';

// A searchable dropdown (combobox). options: [{ value, label, meta?, disabled? }]
export default function SearchSelect({
  options,
  onSelect,
  placeholder = 'Search…',
  emptyText = 'No matches',
  label,
  clearOnSelect = true,
}) {
  const listId = useId();
  const inputRef = useRef(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
  }, [options, query]);

  const choose = (option) => {
    if (!option || option.disabled) return;
    onSelect(option);
    setQuery(clearOnSelect ? '' : option.label);
    setActive(0);
    // Multi-pick lists stay open for the next pick; single picks close (and
    // don't re-focus, which would reopen the list).
    if (clearOnSelect) inputRef.current?.focus();
    else setOpen(false);
  };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, matches.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      if (open && matches[active]) {
        e.preventDefault();
        choose(matches[active]);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div className="select" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setOpen(false)}>
      <input
        ref={inputRef}
        className="input"
        type="text"
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open && matches[active] ? `${listId}-${active}` : undefined}
        value={query}
        placeholder={placeholder}
        autoComplete="off"
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={onKeyDown}
      />
      {open && (
        <ul className="select__list" id={listId} role="listbox">
          {matches.length === 0 && <li className="select__empty">{emptyText}</li>}
          {matches.map((o, i) => (
            <li
              key={o.value}
              id={`${listId}-${i}`}
              role="option"
              tabIndex={-1}
              aria-selected={i === active}
              aria-disabled={o.disabled || undefined}
              className={`select__option${i === active ? ' is-active' : ''}${o.disabled ? ' is-disabled' : ''}`}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(o)}
            >
              <span>{o.label}</span>
              {o.meta && <span className="select__meta">{o.meta}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
