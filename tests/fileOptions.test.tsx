import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nProvider } from '../src/i18n';
import { FileCard } from '../src/components/FileCard';
import { SettingsPanel } from '../src/components/SettingsPanel';
import { DEFAULT_SETTINGS, type Settings } from '../src/lib/settings';
import { activeOverrides, effectiveSettings, fieldsFor, SETTING_FIELDS, showValue, withOption } from '../src/lib/settingFields';
import type { Item } from '../src/types';

const keys = (kind: Parameters<typeof fieldsFor>[0], target: string) => fieldsFor(kind, target).map((f) => f.key);

describe('settings registry', () => {
  it('describes every setting exactly once', () => {
    expect(SETTING_FIELDS.map((f) => f.key).sort()).toEqual(Object.keys(DEFAULT_SETTINGS).sort());
  });

  it('offers the default of every select as one of its choices', () => {
    for (const f of SETTING_FIELDS) {
      if (f.control.type !== 'select') continue;
      expect(f.control.choices.map((c) => c.value), f.key).toContain(DEFAULT_SETTINGS[f.key]);
    }
  });

  // which settings a conversion really reads — the same conditions as the conversion code
  it('gives each conversion only the settings that change it', () => {
    expect(keys('video', 'mp4')).toEqual(['keepMetadata', 'audioLoudness', 'videoCrf', 'videoTargetSize', 'videoPreset', 'videoMaxH', 'videoFps', 'videoMute']);
    expect(keys('video', 'gif')).toEqual(['videoMaxH', 'gifFps', 'gifWidth']);
    expect(keys('video', 'mp3')).toEqual(['keepMetadata', 'audioBitrate', 'audioRateMode', 'audioQuality', 'audioSampleRate', 'audioChannels', 'audioLoudness']);
    expect(keys('audio', 'mp3')).toContain('keepCoverArt');
    expect(keys('audio', 'wav')).not.toContain('keepCoverArt');
    expect(keys('image', 'webp')).toEqual(['imageMaxDim', 'imageTargetSize']);
    expect(keys('image', 'txt')).toEqual(['ocrLang']);
    expect(keys('image', 'ico')).toEqual([]);
    expect(keys('pdf', 'png')).toEqual(['imageMaxDim', 'pdfImageScale']);
    expect(keys('pdf', 'docx')).toEqual(['ocrLang']);
    expect(keys('doc', 'pdf')).toEqual(['docPageSize', 'docFontSize', 'docPdfText']);
    expect(keys('doc', 'csv')).toEqual([]);
  });

  it('never offers an app-wide setting per file', () => {
    const perFile = new Set(['image', 'audio', 'video', 'pdf', 'doc'].flatMap((k) =>
      ['mp3', 'wav', 'mp4', 'webm', 'gif', 'png', 'jpeg', 'webp', 'pdf', 'txt', 'docx', 'ico', 'csv'].flatMap((t) => keys(k as never, t))));
    expect(perFile.has('concurrency')).toBe(false);
    expect(perFile.has('defaultQuality')).toBe(false);
  });
});

describe('per-file overrides', () => {
  it('lays the overrides over the defaults', () => {
    const s = effectiveSettings(DEFAULT_SETTINGS, { audioLoudness: -16 });
    expect(s.audioLoudness).toBe(-16);
    expect(s.audioBitrate).toBe(DEFAULT_SETTINGS.audioBitrate);
    expect(effectiveSettings(DEFAULT_SETTINGS)).toBe(DEFAULT_SETTINGS);
  });

  it('keeps only what differs from the defaults', () => {
    const one = withOption(DEFAULT_SETTINGS, undefined, 'videoTargetSize', 25e6);
    expect(one).toEqual({ videoTargetSize: 25e6 });
    const two = withOption(DEFAULT_SETTINGS, one, 'videoMute', true);
    expect(two).toEqual({ videoTargetSize: 25e6, videoMute: true });
    // back to the default value: the override goes away, and so does the whole object in the end
    const back = withOption(DEFAULT_SETTINGS, two, 'videoTargetSize', 0);
    expect(back).toEqual({ videoMute: true });
    expect(withOption(DEFAULT_SETTINGS, back, 'videoMute', false)).toBeUndefined();
  });

  it('lists an override only while it applies to the chosen output', () => {
    const opts = { videoTargetSize: 25e6, audioLoudness: -16 };
    expect(activeOverrides(DEFAULT_SETTINGS, opts, 'video', 'mp4').map((f) => f.key)).toEqual(['audioLoudness', 'videoTargetSize']);
    expect(activeOverrides(DEFAULT_SETTINGS, opts, 'video', 'mp3').map((f) => f.key)).toEqual(['audioLoudness']);
    expect(activeOverrides(DEFAULT_SETTINGS, opts, 'video', 'gif')).toEqual([]);
    // a default changed to the same value later: no longer an override
    expect(activeOverrides({ ...DEFAULT_SETTINGS, audioLoudness: -16 }, opts, 'video', 'mp3')).toEqual([]);
  });

  it('writes a value the way its control shows it', () => {
    const t = (k: string) => ({ optOn: 'on', optOff: 'off', loudnessPodcast: 'Podcast (−16 LUFS)' }[k] ?? k);
    const field = (key: keyof Settings) => SETTING_FIELDS.find((f) => f.key === key)!;
    expect(showValue(field('videoTargetSize'), 25e6, t)).toBe('25 MB');
    expect(showValue(field('audioLoudness'), -16, t)).toBe('Podcast (−16 LUFS)');
    expect(showValue(field('videoMute'), true, t)).toBe('on');
    expect(showValue(field('gifFps'), 15, t)).toBe('15 fps');
  });
});

describe('file card options', () => {
  const calls = { option: vi.fn(), reset: vi.fn(), project: vi.fn() };
  const noop = () => {};
  const card = (item: Partial<Item> = {}, settings: Settings = DEFAULT_SETTINGS) => {
    const it: Item = { id: 'f1', file: new File(['x'], 'clip.mp4', { type: 'video/mp4' }), kind: 'video', target: 'mp4', quality: 0.9, status: 'ready', progress: 0, meta: { mime: 'video/mp4' } as Item['meta'], ...item };
    return render(
      <I18nProvider>
        <FileCard item={it} settings={settings} onOption={calls.option} onResetOptions={calls.reset} onTarget={noop} onQuality={noop} onConvert={noop} onRemove={noop} onEdit={noop} onToProject={calls.project} onUnlock={noop} onQr={noop} />
      </I18nProvider>
    );
  };
  beforeEach(() => { localStorage.clear(); localStorage.setItem('morphkit-lang', 'en'); });
  afterEach(() => { cleanup(); vi.clearAllMocks(); });

  it('says a new file uses the defaults, and opens its own controls on demand', async () => {
    const user = userEvent.setup();
    card();
    expect(screen.getByText('using the defaults')).toBeTruthy();
    expect(screen.queryByLabelText(/^Target file size/)).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Adjust' }));
    // only what changes a video → MP4 conversion; an audio-only setting is not offered
    expect(screen.getByLabelText(/^Target file size/)).toBeTruthy();
    expect(screen.queryByLabelText(/^Audio bitrate/)).toBeNull();
    await user.selectOptions(screen.getByLabelText(/^Target file size/), '25 MB');
    expect(calls.option).toHaveBeenCalledWith('f1', 'videoTargetSize', 25e6);
  });

  it('shows each override as a chip that puts the default back', async () => {
    const user = userEvent.setup();
    card({ opts: { videoTargetSize: 25e6, audioLoudness: -16 } });
    expect(screen.queryByText('using the defaults')).toBeNull();
    expect(screen.getByText(/Target file size：25 MB/)).toBeTruthy();
    expect(screen.getByText(/Loudness：Podcast \(−16 LUFS\)/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Target file size: back to the default' }));
    expect(calls.option).toHaveBeenCalledWith('f1', 'videoTargetSize', 0);
    await user.click(screen.getByRole('button', { name: 'Reset all' }));
    expect(calls.reset).toHaveBeenCalledWith('f1');
  });

  it('applies the same rules as the drawer to the file’s own values', async () => {
    const user = userEvent.setup();
    card({ opts: { videoTargetSize: 25e6 } });
    await user.click(screen.getByRole('button', { name: 'Adjust' }));
    // a size target replaces CRF for THIS file, although the default has no target
    expect((screen.getByLabelText(/Video quality CRF/) as HTMLInputElement).disabled).toBe(true);
  });

  it('has no options row when nothing can be changed', () => {
    card({ file: new File(['x'], 'logo.png', { type: 'image/png' }), kind: 'image', target: 'ico' });
    expect(screen.queryByText('Options')).toBeNull();
  });

  it('keeps Edit in the row and moves the rest into one menu', async () => {
    const user = userEvent.setup();
    card();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy();
    expect(screen.queryByText('Save as project')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'More' }));
    expect(screen.getByRole('menuitem', { name: /File details/ })).toBeTruthy();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'More' }));
    await user.click(screen.getByRole('menuitem', { name: /Save as project/ }));
    expect(calls.project).toHaveBeenCalledWith('f1');
    expect(screen.queryByRole('menu')).toBeNull();
  });
});

describe('settings drawer', () => {
  beforeEach(() => { localStorage.clear(); localStorage.setItem('morphkit-lang', 'en'); });
  afterEach(cleanup);

  it('says these are defaults, and keeps numbers as numbers', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<I18nProvider><SettingsPanel settings={DEFAULT_SETTINGS} onChange={onChange} /></I18nProvider>);
    expect(screen.getByText(/^These are the defaults for files you add/)).toBeTruthy();
    for (const title of ['General', 'Image', 'Audio', 'Video', 'PDF', 'Documents', 'GIF']) {
      expect(screen.getByRole('heading', { name: title })).toBeTruthy();
    }
    await user.selectOptions(screen.getByLabelText('Max resolution'), '720p');
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_SETTINGS, videoMaxH: 720 });
    await user.click(screen.getByLabelText('Remove audio track'));
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_SETTINGS, videoMute: true });
    // VBR quality only exists in VBR mode
    expect(screen.queryByLabelText('VBR quality')).toBeNull();
  });
});
