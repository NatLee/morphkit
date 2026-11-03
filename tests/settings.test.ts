import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from '../src/lib/settings';

beforeEach(() => localStorage.clear());

describe('settings', () => {
  it('starts from the defaults', () => {
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('round-trips through localStorage', () => {
    saveSettings({ ...DEFAULT_SETTINGS, concurrency: 4, audioBitrate: '320k' });
    expect(loadSettings().concurrency).toBe(4);
    expect(loadSettings().audioBitrate).toBe('320k');
  });

  it('fills in settings added after the user last saved', () => {
    localStorage.setItem('morphkit-settings', JSON.stringify({ concurrency: 3 }));
    const s = loadSettings();
    expect(s.concurrency).toBe(3);
    expect(s.docPdfText).toBe(DEFAULT_SETTINGS.docPdfText);
  });

  it('ignores a corrupt saved value', () => {
    localStorage.setItem('morphkit-settings', '{not json');
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });
});
