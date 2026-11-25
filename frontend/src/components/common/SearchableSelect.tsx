import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from '../../i18n';

export type SearchableSelectOption = {
  value: string;
  label: string;
  keywords?: string;
  disabled?: boolean;
};

type SearchableSelectProps = {
  options: SearchableSelectOption[];
  value: string;
  onChange: (value: string) => void;
  id?: string;
  name?: string;
  ariaLabel?: string;
  ariaBusy?: boolean;
  disabled?: boolean;
  required?: boolean;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  searchableThreshold?: number;
  className?: string;
};

function normalizeSearchText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'd')
    .toLowerCase()
    .trim();
}

export function SearchableSelect({
  options,
  value,
  onChange,
  id,
  name,
  ariaLabel,
  ariaBusy,
  disabled = false,
  required = false,
  placeholder,
  searchPlaceholder,
  emptyText,
  searchableThreshold = 5,
  className,
}: SearchableSelectProps) {
  const { t } = useTranslation();
  const generatedId = useId();
  const controlId = id || generatedId;
  const listboxId = `${controlId}-listbox`;

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(0);

  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const isSearchable = options.length > searchableThreshold;
  const selectedOption = useMemo(
    () => options.find((opt) => opt.value === value) ?? null,
    [options, value],
  );

  const filteredOptions = useMemo(() => {
    const normalizedQuery = normalizeSearchText(query);
    if (!normalizedQuery) return options;
    return options.filter((opt) => {
      const haystack = normalizeSearchText(`${opt.label} ${opt.keywords ?? ''}`);
      return haystack.includes(normalizedQuery);
    });
  }, [options, query]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const activeIndex = filteredOptions.findIndex((opt) => opt.value === value && !opt.disabled);
    setHighlightedIndex(activeIndex >= 0 ? activeIndex : 0);
    window.requestAnimationFrame(() => {
      searchRef.current?.focus();
    });
  }, [open, filteredOptions, value]);

  if (!isSearchable) {
    return (
      <select
        id={controlId}
        name={name}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-label={ariaLabel}
        aria-busy={ariaBusy}
        disabled={disabled}
        required={required}
        className={className}
      >
        {placeholder && !options.some((opt) => opt.value === '') && (
          <option value="" disabled={required}>
            {placeholder}
          </option>
        )}
        {options.map((opt) => (
          <option key={opt.value} value={opt.value} disabled={opt.disabled}>
            {opt.label}
          </option>
        ))}
      </select>
    );
  }

  function selectValue(nextValue: string) {
    onChange(nextValue);
    setOpen(false);
    setQuery('');
    triggerRef.current?.focus();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
      setQuery('');
      triggerRef.current?.focus();
      return;
    }
    if (!filteredOptions.length) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlightedIndex((prev) => (prev + 1) % filteredOptions.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlightedIndex((prev) => (prev - 1 + filteredOptions.length) % filteredOptions.length);
    } else if (event.key === 'Enter' && open) {
      const target = filteredOptions[highlightedIndex];
      if (target && !target.disabled) {
        event.preventDefault();
        selectValue(target.value);
      }
    }
  }

  const displayLabel = selectedOption?.label || placeholder || t('selectOption');

  return (
    <div
      ref={rootRef}
      className={'hr-searchable-select' + (className ? ` ${className}` : '')}
      data-open={open}
    >
      {name && (
        <input
          type="text"
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          name={name}
          value={value}
          required={required}
          onChange={() => {}}
        />
      )}
      <button
        ref={triggerRef}
        id={controlId}
        type="button"
        className="hr-select-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-label={ariaLabel}
        aria-busy={ariaBusy}
        disabled={disabled}
        onClick={() => {
          if (disabled) return;
          setOpen((prev) => !prev);
          if (open) setQuery('');
        }}
      >
        <span className={'hr-select-value' + (!selectedOption ? ' is-placeholder' : '')}>
          {displayLabel}
        </span>
        <span className="hr-select-caret" aria-hidden="true">
          ▾
        </span>
      </button>

      {open && (
        <div className="hr-select-popover" onKeyDown={handleKeyDown}>
          <div className="hr-select-search-box">
            <input
              ref={searchRef}
              type="search"
              className="hr-select-search-input"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setHighlightedIndex(0);
              }}
              placeholder={searchPlaceholder || t('searchOptions')}
              aria-label={searchPlaceholder || t('searchOptions')}
            />
          </div>
          <ul
            id={listboxId}
            role="listbox"
            className="hr-select-options"
            aria-label={ariaLabel || displayLabel}
          >
            {filteredOptions.length === 0 ? (
              <li className="hr-select-empty">{emptyText || t('noMatchingOptions')}</li>
            ) : (
              filteredOptions.map((opt, index) => {
                const selected = opt.value === value;
                const active = index === highlightedIndex;
                return (
                  <li
                    key={opt.value}
                    role="option"
                    aria-selected={selected}
                    aria-disabled={opt.disabled}
                    className={
                      'hr-select-option' +
                      (selected ? ' is-selected' : '') +
                      (active ? ' is-highlighted' : '') +
                      (opt.disabled ? ' is-disabled' : '')
                    }
                    onMouseEnter={() => setHighlightedIndex(index)}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      if (!opt.disabled) selectValue(opt.value);
                    }}
                  >
                    <span className="hr-select-option-label">{opt.label}</span>
                    {selected && (
                      <span className="hr-select-check" aria-hidden="true">
                        ✓
                      </span>
                    )}
                  </li>
                );
              })
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
