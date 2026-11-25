import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import { LanguageSelector } from './LanguageSelector';
import { setLocale, useTranslation } from './index';

function Example() {
  const { t } = useTranslation();
  return (
    <>
      <LanguageSelector />
      <p>{t('home')}</p>
    </>
  );
}

afterEach(() => {
  cleanup();
  setLocale('vi');
  localStorage.clear();
});

describe('language selection', () => {
  it('restores the saved preference when the module is loaded again', async () => {
    localStorage.setItem('managerhr.locale', 'en');
    vi.resetModules();
    const { LanguageSelector: ReloadedSelector } = await import('./LanguageSelector');
    render(<ReloadedSelector />);
    expect((screen.getByLabelText('Language') as HTMLSelectElement).value).toBe('en');
    expect(document.documentElement.lang).toBe('en');
  });
  it('changes translated text and saves the preference', () => {
    setLocale('vi');
    render(<Example />);
    expect(screen.getByText('Trang chủ')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Ngôn ngữ'), { target: { value: 'en' } });
    expect(screen.getByText('Home')).toBeTruthy();
    expect(screen.getByLabelText('Language')).toBeTruthy();
    expect(localStorage.getItem('managerhr.locale')).toBe('en');
    expect(document.documentElement.lang).toBe('en');
  });
});
