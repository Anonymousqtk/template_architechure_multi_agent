import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SearchableSelect } from './SearchableSelect';
import { setLocale } from '../../i18n';

afterEach(() => {
  cleanup();
  setLocale('vi');
});

describe('SearchableSelect', () => {
  it('renders native select when options do not exceed threshold', () => {
    const onChange = vi.fn();
    render(
      <label>
        Phòng ban
        <SearchableSelect
          value=""
          onChange={onChange}
          options={[
            { value: '', label: 'Tất cả' },
            { value: 'd1', label: 'Phòng Kỹ thuật' },
            { value: 'd2', label: 'Phòng Nhân sự' },
          ]}
        />
      </label>,
    );

    const select = screen.getByLabelText('Phòng ban');
    expect(select.tagName).toBe('SELECT');
    fireEvent.change(select, { target: { value: 'd1' } });
    expect(onChange).toHaveBeenCalledWith('d1');
  });

  it('renders searchable dropdown with inline search input when options exceed threshold', () => {
    const onChange = vi.fn();
    const options = [
      { value: '', label: 'Tất cả phòng ban' },
      { value: 'd1', label: 'Phòng Kỹ thuật (ENG)' },
      { value: 'd2', label: 'Phòng Nhân sự (HR)' },
      { value: 'd3', label: 'Phòng Kế toán (ACC)' },
      { value: 'd4', label: 'Phòng Kinh doanh (SALES)' },
      { value: 'd5', label: 'Phòng Vận hành (OPS)' },
    ];

    render(
      <label>
        Phòng ban
        <SearchableSelect value="" onChange={onChange} options={options} />
      </label>,
    );

    const trigger = screen.getByRole('button', { name: /Phòng ban/ });
    fireEvent.click(trigger);

    const searchInput = screen.getByRole('searchbox', { name: 'Tìm kiếm lựa chọn…' });
    expect(searchInput).toBeVisible();

    // Accent-insensitive filtering
    fireEvent.change(searchInput, { target: { value: 'ke toan' } });
    expect(screen.getByRole('option', { name: 'Phòng Kế toán (ACC)' })).toBeVisible();
    expect(screen.queryByRole('option', { name: 'Phòng Kỹ thuật (ENG)' })).not.toBeInTheDocument();

    fireEvent.mouseDown(screen.getByRole('option', { name: 'Phòng Kế toán (ACC)' }));
    expect(onChange).toHaveBeenCalledWith('d3');
  });
});
