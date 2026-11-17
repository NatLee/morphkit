import { ART_CAPABLE, AV_TARGETS, H264_TARGETS } from './ffmpegClient';
import { AUDIO_OUTPUTS, PDF_TEXT_OUTPUTS, RASTER_OUTPUTS, type Kind } from './formats';
import { MIN_QUALITY } from './imageConvert';
import { OCR_LANGS } from './ocr';
import type { Settings } from './settings';

/**
 * The one description of every setting: how it is shown (label, control, hint) and which
 * conversions it changes. The settings drawer renders all of them, as the defaults for new files;
 * a file card renders the ones that apply to its own conversion and may override them for that
 * file only (`Item.opts`). A new setting is one entry here — see .claude/skills/add-setting.
 */

export type SettingSection = 'general' | 'image' | 'audio' | 'video' | 'pdf' | 'doc' | 'gif';
/** Drawer order; a title is an i18n key, or literal text when it is the same in every language. */
export const SETTING_SECTIONS: ReadonlyArray<{ id: SettingSection; titleKey?: string; title?: string }> = [
  { id: 'general', titleKey: 'secGeneral' },
  { id: 'image', titleKey: 'kindImage' },
  { id: 'audio', titleKey: 'kindAudio' },
  { id: 'video', titleKey: 'kindVideo' },
  { id: 'pdf', title: 'PDF' },
  { id: 'doc', titleKey: 'secDocs' },
  { id: 'gif', title: 'GIF' },
];

export type SettingValue = Settings[keyof Settings];
export interface Choice {
  value: string | number;
  /** literal text (units, codec names) or an i18n key */
  label?: string;
  labelKey?: string;
}
export type Control =
  | { type: 'select'; choices: readonly Choice[] }
  | { type: 'range'; min: number; max: number; step: number; show: (v: number) => string }
  | { type: 'check' };

export interface SettingField {
  key: keyof Settings;
  section: SettingSection;
  labelKey: string;
  control: Control;
  hintKey?: string;
  hintVars?: Record<string, string>;
  /** show the hint only while this holds */
  hintWhen?: (s: Settings) => boolean;
  /** the conversions this setting changes; absent = app-wide, never a per-file option */
  applies?: (kind: Kind, target: string) => boolean;
  visible?: (s: Settings) => boolean;
  disabled?: (s: Settings) => boolean;
}

const has = (list: readonly string[] | ReadonlySet<string>, v: string) =>
  list instanceof Set ? list.has(v) : (list as readonly string[]).includes(v);
const sound = (kind: Kind) => kind === 'audio' || kind === 'video';
/** Decimal sizes on purpose: "500 KB" may mean 500,000 or 512,000 bytes, and a file under the decimal figure passes both. */
const sizeChoice = (bytes: number): Choice => ({ value: bytes, label: bytes >= 1e6 ? `${bytes / 1e6} MB` : `${bytes / 1e3} KB` });
const original: Choice = { value: 0, labelKey: 'original' };
/** LAME VBR presets and the average bitrate each typically lands on. */
const VBR_LEVELS: ReadonlyArray<[q: number, kbps: number]> = [
  [0, 245], [1, 225], [2, 190], [3, 175], [4, 165], [5, 130], [6, 115], [7, 100], [8, 85], [9, 65],
];

export const SETTING_FIELDS: readonly SettingField[] = [
  // ---- general ----
  { key: 'concurrency', section: 'general', labelKey: 'workers', hintKey: 'workersHint',
    control: { type: 'select', choices: [1, 2, 3, 4].map((n) => ({ value: n, label: String(n) })) } },
  { key: 'keepMetadata', section: 'general', labelKey: 'keepMetadata', hintKey: 'keepMetadataHint', control: { type: 'check' },
    applies: (k, t) => sound(k) && t !== 'gif' },
  { key: 'keepCoverArt', section: 'general', labelKey: 'keepCoverArt', hintKey: 'keepCoverArtHint', control: { type: 'check' },
    applies: (k, t) => k === 'audio' && has(ART_CAPABLE, t), disabled: (s) => !s.keepMetadata },

  // ---- image ----
  { key: 'defaultQuality', section: 'image', labelKey: 'defaultQuality', hintKey: 'defaultQualityHint',
    control: { type: 'range', min: MIN_QUALITY, max: 1, step: 0.01, show: (v) => `${Math.round(v * 100)}%` } },
  { key: 'imageMaxDim', section: 'image', labelKey: 'imageMaxDim',
    control: { type: 'select', choices: [original, ...[4096, 2048, 1024, 512].map((n) => ({ value: n, label: `${n}px` }))] },
    applies: (k, t) => (k === 'image' || k === 'pdf') && has(RASTER_OUTPUTS, t) },
  { key: 'imageTargetSize', section: 'image', labelKey: 'targetSize', hintKey: 'imageTargetSizeHint',
    hintVars: { min: `${Math.round(MIN_QUALITY * 100)}%` },
    control: { type: 'select', choices: [{ value: 0, labelKey: 'targetSizeOff' }, ...[100e3, 200e3, 500e3, 1e6, 2e6, 5e6].map(sizeChoice)] },
    applies: (k, t) => k === 'image' && has(RASTER_OUTPUTS, t) },
  { key: 'ocrLang', section: 'image', labelKey: 'ocrLang', hintKey: 'ocrLangHint',
    control: { type: 'select', choices: [{ value: 'auto', labelKey: 'ocrLangAuto' }, ...Object.entries(OCR_LANGS).map(([value, label]) => ({ value, label }))] },
    applies: (k, t) => (k === 'image' && t === 'txt') || (k === 'pdf' && has(PDF_TEXT_OUTPUTS, t)) },

  // ---- audio (also the sound of video outputs where it says so) ----
  { key: 'audioBitrate', section: 'audio', labelKey: 'audioBitrate', hintKey: 'audioBitrateVbrHint', hintWhen: (s) => s.audioRateMode === 'vbr',
    control: { type: 'select', choices: ['128k', '192k', '256k', '320k'].map((b) => ({ value: b, label: b.replace('k', ' kbps') })) },
    applies: (k, t) => sound(k) && (t === 'mp3' || t === 'm4a') },
  { key: 'audioRateMode', section: 'audio', labelKey: 'audioRateMode', hintKey: 'audioRateModeHint',
    control: { type: 'select', choices: [{ value: 'cbr', labelKey: 'audioCbr' }, { value: 'vbr', labelKey: 'audioVbr' }] },
    applies: (k, t) => sound(k) && (t === 'mp3' || t === 'ogg') },
  { key: 'audioQuality', section: 'audio', labelKey: 'audioQuality', hintKey: 'audioQualityHint',
    control: { type: 'select', choices: VBR_LEVELS.map(([q, kbps]) => ({ value: q, label: `V${q} ≈ ${kbps} kbps` })) },
    applies: (k, t) => sound(k) && (t === 'mp3' || t === 'ogg'), visible: (s) => s.audioRateMode === 'vbr' },
  { key: 'audioSampleRate', section: 'audio', labelKey: 'audioSampleRate',
    control: { type: 'select', choices: [original, ...[44100, 48000].map((n) => ({ value: n, label: `${(n / 1000).toFixed(1)} kHz` }))] },
    applies: (k, t) => sound(k) && has(AUDIO_OUTPUTS, t) },
  { key: 'audioChannels', section: 'audio', labelKey: 'audioChannels',
    control: { type: 'select', choices: [original, { value: 2, labelKey: 'stereo' }, { value: 1, labelKey: 'mono' }] },
    applies: (k, t) => sound(k) && has(AUDIO_OUTPUTS, t) },
  { key: 'audioLoudness', section: 'audio', labelKey: 'audioLoudness', hintKey: 'audioLoudnessHint',
    control: { type: 'select', choices: [
      { value: 0, labelKey: 'loudnessOff' },
      // each target is named after where such files usually go
      { value: -14, labelKey: 'loudnessStreaming' }, { value: -16, labelKey: 'loudnessPodcast' }, { value: -23, labelKey: 'loudnessBroadcast' },
    ] },
    applies: (k, t) => sound(k) && (has(AUDIO_OUTPUTS, t) || has(AV_TARGETS, t)) },

  // ---- video ----
  { key: 'videoCrf', section: 'video', labelKey: 'videoCrf', hintKey: 'videoCrfHint',
    control: { type: 'range', min: 18, max: 32, step: 1, show: String },
    applies: (k, t) => k === 'video' && has(AV_TARGETS, t), disabled: (s) => s.videoTargetSize > 0 },
  { key: 'videoTargetSize', section: 'video', labelKey: 'targetSize', hintKey: 'videoTargetSizeHint',
    control: { type: 'select', choices: [{ value: 0, labelKey: 'targetSizeOff' }, ...[10e6, 25e6, 50e6, 100e6].map(sizeChoice)] },
    applies: (k, t) => k === 'video' && has(AV_TARGETS, t) },
  { key: 'videoPreset', section: 'video', labelKey: 'videoPreset', hintKey: 'presetHint',
    control: { type: 'select', choices: ['veryfast', 'fast', 'medium'].map((p) => ({ value: p, label: p })) },
    applies: (k, t) => k === 'video' && has(H264_TARGETS, t) },
  { key: 'videoMaxH', section: 'video', labelKey: 'videoRes',
    control: { type: 'select', choices: [original, ...[1080, 720, 480].map((n) => ({ value: n, label: `${n}p` }))] },
    applies: (k, t) => k === 'video' && (has(AV_TARGETS, t) || t === 'gif') },
  { key: 'videoFps', section: 'video', labelKey: 'videoFps',
    control: { type: 'select', choices: [original, ...[60, 30, 24].map((n) => ({ value: n, label: `${n} fps` }))] },
    applies: (k, t) => k === 'video' && has(AV_TARGETS, t) },
  { key: 'videoMute', section: 'video', labelKey: 'videoMute', control: { type: 'check' },
    applies: (k, t) => k === 'video' && has(AV_TARGETS, t) },

  // ---- pdf ----
  { key: 'pdfImageScale', section: 'pdf', labelKey: 'pdfImageScale', hintKey: 'pdfImageScaleHint',
    control: { type: 'select', choices: [1, 2, 3].map((n) => ({ value: n, label: `${n * 72} dpi` })) },
    applies: (k, t) => k === 'pdf' && has(RASTER_OUTPUTS, t) },

  // ---- documents ----
  { key: 'docPageSize', section: 'doc', labelKey: 'docPageSizeLabel',
    control: { type: 'select', choices: [{ value: 'a4', label: 'A4' }, { value: 'letter', label: 'Letter' }] },
    applies: (k, t) => k === 'doc' && (t === 'pdf' || t === 'png') },
  { key: 'docFontSize', section: 'doc', labelKey: 'docFontSizeLabel',
    control: { type: 'select', choices: [9, 10, 11, 12, 13, 14].map((n) => ({ value: n, label: `${n} pt` })) },
    applies: (k, t) => k === 'doc' && (t === 'pdf' || t === 'png') },
  { key: 'docPdfText', section: 'doc', labelKey: 'docPdfTextLabel', hintKey: 'docPdfTextHint', control: { type: 'check' },
    applies: (k, t) => k === 'doc' && t === 'pdf' },

  // ---- gif (video → GIF) ----
  { key: 'gifFps', section: 'gif', labelKey: 'gifFps',
    control: { type: 'range', min: 5, max: 24, step: 1, show: (v) => `${v} fps` },
    applies: (k, t) => k === 'video' && t === 'gif' },
  { key: 'gifWidth', section: 'gif', labelKey: 'gifWidth',
    control: { type: 'select', choices: [240, 360, 480, 640, 720].map((w) => ({ value: w, label: `${w}px` })) },
    applies: (k, t) => k === 'video' && t === 'gif' },
];

/** The settings one conversion can override, in drawer order. */
export function fieldsFor(kind: Kind, target: string): SettingField[] {
  return SETTING_FIELDS.filter((f) => f.applies?.(kind, target));
}

/** Defaults with one file's overrides on top — what its conversion actually uses. */
export function effectiveSettings(defaults: Settings, opts?: Partial<Settings>): Settings {
  return opts ? { ...defaults, ...opts } : defaults;
}

/**
 * One file's overrides after setting `key` to `value`: an override equal to the default is dropped,
 * so a file only carries what really differs (and follows the defaults again for the rest).
 */
export function withOption(defaults: Settings, opts: Partial<Settings> | undefined, key: keyof Settings, value: SettingValue): Partial<Settings> | undefined {
  const next: Record<string, SettingValue> = { ...opts };
  if (defaults[key] === value) delete next[key];
  else next[key] = value;
  return Object.keys(next).length ? (next as Partial<Settings>) : undefined;
}

/** The overrides of a file that apply to its current conversion and differ from the defaults. */
export function activeOverrides(defaults: Settings, opts: Partial<Settings> | undefined, kind: Kind, target: string): SettingField[] {
  if (!opts) return [];
  return fieldsFor(kind, target).filter((f) => f.key in opts && opts[f.key] !== defaults[f.key]);
}

/** A value as the field's own control would show it. */
export function showValue(field: SettingField, value: SettingValue, t: (key: string) => string): string {
  const c = field.control;
  if (c.type === 'check') return t(value ? 'optOn' : 'optOff');
  if (c.type === 'range') return c.show(Number(value));
  const choice = c.choices.find((x) => x.value === value);
  return choice ? (choice.labelKey ? t(choice.labelKey) : choice.label ?? String(value)) : String(value);
}
