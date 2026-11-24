import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { EmployeeCardPage } from './EmployeeCardPage';

describe('EmployeeCardPage component', () => {
  afterEach(() => cleanup());

  it('clearly states that the local preview does not expose employee information', () => {
    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);

    render(<EmployeeCardPage />);

    expect(screen.getByRole('status')).toHaveTextContent('Thẻ công khai chưa được bật');
    expect(screen.getByText(/không tải hoặc hiển thị thông tin nhân viên/i)).toBeInTheDocument();
    expect(mockFetch).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
