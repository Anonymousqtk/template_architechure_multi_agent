import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SlideDialog } from './SlideDialog';
import { setLocale } from '../../i18n';
import type { FormEvent } from 'react';

afterEach(() => {
  cleanup();
  setLocale('vi');
});

it('opens a labeled dialog and requests close on Escape', () => {
  const onClose = vi.fn();
  render(
    <SlideDialog label="Payslip details" onClose={onClose}>
      <button>Close</button>
    </SlideDialog>,
  );
  const dialog = screen.getByRole('dialog', { name: 'Payslip details' });
  expect(dialog.hasAttribute('open')).toBe(true);
  fireEvent(dialog, new Event('cancel', { bubbles: false, cancelable: true }));
  expect(onClose).toHaveBeenCalledOnce();
});

it('provides translated close and cancel controls and respects the busy state', () => {
  const onClose = vi.fn();
  setLocale('en');
  const { rerender } = render(
    <SlideDialog label="Details" onClose={onClose}>
      Content
    </SlideDialog>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(onClose).toHaveBeenCalledTimes(2);
  rerender(
    <SlideDialog label="Details" onClose={onClose} closeDisabled>
      Content
    </SlideDialog>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));
  expect(onClose).toHaveBeenCalledTimes(2);
});

it('keeps cancel and a form action together without submitting on cancel', () => {
  const onClose = vi.fn();
  const onSubmit = vi.fn((event: FormEvent<HTMLFormElement>) => event.preventDefault());
  setLocale('en');
  render(
    <SlideDialog
      label="Create"
      onClose={onClose}
      action={
        <button type="submit" form="test-form">
          Save
        </button>
      }
    >
      <form id="test-form" onSubmit={onSubmit}>
        <input aria-label="Name" required defaultValue="Example" />
      </form>
    </SlideDialog>,
  );
  const cancel = screen.getByRole('button', { name: 'Cancel' });
  const save = screen.getByRole('button', { name: 'Save' });
  expect(cancel.parentElement).toBe(save.parentElement);
  expect(screen.getByRole('textbox', { name: 'Name' }).closest('.slide-dialog-body')).toBeTruthy();
  expect(cancel.closest('.slide-dialog-body')).toBeNull();
  fireEvent.click(cancel);
  expect(onClose).toHaveBeenCalledOnce();
  expect(onSubmit).not.toHaveBeenCalled();
  fireEvent.click(save);
  expect(onSubmit).toHaveBeenCalledOnce();
});
