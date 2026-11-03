import { describe, expect, it } from 'vitest';
import { classifyPayload, payloads } from '../src/lib/qr';

describe('QR payload builders', () => {
  it('builds Wi-Fi payloads and escapes the special characters', () => {
    expect(payloads.wifi('Home;Net', 'p:a"ss', 'WPA')).toBe('WIFI:T:WPA;S:Home\\;Net;P:p\\:a\\"ss;;');
    expect(payloads.wifi('Cafe', '', 'nopass', true)).toBe('WIFI:T:nopass;S:Cafe;H:true;;');
  });

  it('builds a vCard with only the fields that were filled in', () => {
    const v = payloads.vcard({ name: 'Ada Lovelace', email: 'ada@example.com' });
    expect(v.split('\n')).toEqual(['BEGIN:VCARD', 'VERSION:3.0', 'FN:Ada Lovelace', 'N:Ada Lovelace;;;;', 'EMAIL:ada@example.com', 'END:VCARD']);
  });

  it('builds mailto links with an encoded subject and body', () => {
    expect(payloads.mail('a@b.c', '', '')).toBe('mailto:a@b.c');
    expect(payloads.mail('a@b.c', 'Hi there', 'x&y')).toBe('mailto:a@b.c?subject=Hi%20there&body=x%26y');
  });
});

describe('classifyPayload', () => {
  it('recognises the common payload types', () => {
    expect(classifyPayload('https://example.com')).toBe('url');
    expect(classifyPayload('WIFI:T:WPA;S:x;P:y;;')).toBe('wifi');
    expect(classifyPayload('BEGIN:VCARD\nEND:VCARD')).toBe('vcard');
    expect(classifyPayload('mailto:a@b.c')).toBe('mail');
    expect(classifyPayload('just words')).toBe('text');
  });
});
