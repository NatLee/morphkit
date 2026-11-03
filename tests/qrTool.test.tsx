import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nProvider } from '../src/i18n';
import { QrTool } from '../src/components/QrTool';

// the live preview needs a real canvas; the form is what this test is about
vi.mock('../src/lib/qr', async (orig) => ({
  ...(await orig<typeof import('../src/lib/qr')>()),
  qrToCanvas: vi.fn(async () => document.createElement('canvas')),
}));
HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,';
afterEach(cleanup);

function open() {
  localStorage.setItem('morphkit-lang', 'en');
  render(
    <I18nProvider>
      <QrTool onAddImage={() => {}} onClose={() => {}} />
    </I18nProvider>
  );
}

describe('QrTool form fields', () => {
  // Regression: the field component used to be declared inside QrTool, so React saw a new
  // component type on every render and remounted the <input> after each keystroke —
  // focus was lost and only the first character ever landed.
  it('keeps every typed character in the Wi-Fi fields', async () => {
    const user = userEvent.setup();
    open();
    await user.click(screen.getByRole('button', { name: 'Wi-Fi' }));
    const ssid = screen.getByLabelText('SSID');
    await user.click(ssid);
    await user.keyboard('HomeNet');
    expect(screen.getByLabelText('SSID')).toHaveProperty('value', 'HomeNet');
    expect(document.activeElement).toBe(screen.getByLabelText('SSID'));
  });

  it('keeps every typed character in the contact card fields', async () => {
    const user = userEvent.setup();
    open();
    await user.click(screen.getByRole('button', { name: 'Contact' }));
    const inputs = screen.getAllByRole('textbox');
    await user.click(inputs[0]);
    await user.keyboard('Ada Lovelace');
    expect(screen.getAllByRole('textbox')[0]).toHaveProperty('value', 'Ada Lovelace');
  });
});
