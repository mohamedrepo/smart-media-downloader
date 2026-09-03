import { describe, expect, it } from 'vitest';
import {
  extractIdentifier,
  extractSubtitleTracksFromFiles,
  isMediaFile,
  mapFilesToFormats,
  parseIaLength,
  type IaFile,
} from '../src/adapters/internet-archive-adapter';

/** Real fixture from https://archive.org/metadata/night-alarm (verified live). */
const NIGHT_ALARM_MP4: IaFile = {
  name: 'Night Alarm.mp4',
  size: '203137386',
  format: 'MPEG4',
  length: '3696.22',
};

const identifier = 'night-alarm';

describe('extractIdentifier', () => {
  it('extracts identifiers from item URLs', () => {
    expect(extractIdentifier('https://archive.org/details/night-alarm')).toBe('night-alarm');
    expect(extractIdentifier('https://archive.org/download/night-alarm/Night Alarm.mp4')).toBe('night-alarm');
    expect(extractIdentifier('https://archive.org/metadata/night-alarm')).toBe('night-alarm');
    expect(extractIdentifier('https://archive.org/embed/night-alarm?start=1')).toBe('night-alarm');
  });

  it('rejects non-archive hosts, other schemes, and garbage', () => {
    expect(extractIdentifier('https://youtube.com/watch?v=x')).toBeNull();
    expect(extractIdentifier('https://archive-not.org/details/x')).toBeNull();
    expect(extractIdentifier('javascript:alert(1)')).toBeNull();
    expect(extractIdentifier('https://archive.org/about/terms.php')).toBeNull();
    expect(extractIdentifier('not a url')).toBeNull();
  });

  it('accepts subdomains and decodes the identifier', () => {
    expect(extractIdentifier('https://www.archive.org/details/prelinger%20docs')).toBe(
      'prelinger docs',
    );
  });
});

describe('isMediaFile', () => {
  it('accepts media extensions and rejects metadata/thumbnails', () => {
    expect(isMediaFile('Night Alarm.mp4')).toBe(true);
    expect(isMediaFile('soundtrack.ogg')).toBe(true);
    expect(isMediaFile('Night Alarm_meta.xml')).toBe(false);
    expect(isMediaFile('thumbnail.gif')).toBe(false);
    expect(isMediaFile('docs.txt')).toBe(false);
    expect(isMediaFile('noextension')).toBe(false);
  });
});

describe('parseIaLength', () => {
  it('parses plain seconds', () => {
    expect(parseIaLength('3696.22')).toBe(3696.22);
    expect(parseIaLength('0')).toBe(0);
  });

  it('parses colon formats', () => {
    expect(parseIaLength('02:03')).toBe(123);
    expect(parseIaLength('1:02:03')).toBe(3723);
  });

  it('returns undefined for absent or invalid values', () => {
    expect(parseIaLength(undefined)).toBeUndefined();
    expect(parseIaLength('')).toBeUndefined();
    expect(parseIaLength('soon')).toBeUndefined();
    expect(parseIaLength('1:2:3:4')).toBeUndefined();
  });
});

describe('mapFilesToFormats', () => {

  it('maps the real night-alarm fixture', () => {
    const formats = mapFilesToFormats([NIGHT_ALARM_MP4], identifier);
    expect(formats).toHaveLength(1);
    expect(formats[0]).toMatchObject({
      id: 'ia:night-alarm:Night Alarm.mp4',
      label: 'MPEG4',
      container: 'mp4',
      estimatedSizeBytes: 203137386,
      isAudioOnly: false,
      requiresAuthorization: false,
    });
    // File name contains a space → must be percent-encoded per segment.
    expect(formats[0]!.downloadUrl).toBe(
      'https://archive.org/download/night-alarm/Night%20Alarm.mp4',
    );
  });

  it('skips non-media files and sorts largest-first', () => {
    const formats = mapFilesToFormats(
      [
        { name: 'meta.xml' },
        { name: 'small.mp4', size: '100', format: 'MPEG4' },
        { name: 'big.mp4', size: '9999999', format: 'h.264' },
        { name: 'song.mp3', size: '5000', format: 'MP3' },
      ],
      identifier,
    );
    expect(formats.map((f) => f.label)).toEqual(['h.264', 'MP3', 'MPEG4']);
    expect(formats.find((f) => f.container === 'mp3')!.isAudioOnly).toBe(true);
  });

  it('caps the list at 25 formats', () => {
    const many: IaFile[] = Array.from({ length: 30 }, (_, i) => ({
      name: `file${i}.mp4`,
      size: String(1000 + i),
      format: 'MPEG4',
    }));
    expect(mapFilesToFormats(many, identifier)).toHaveLength(25);
  });

  it('treats missing sizes as zero', () => {
    const formats = mapFilesToFormats([{ name: 'x.mp4' }], identifier);
    expect(formats[0]!.estimatedSizeBytes).toBeUndefined();
  });
});

describe('extractSubtitleTracksFromFiles', () => {
  it('maps caption files with language suffixes', () => {
    const tracks = extractSubtitleTracksFromFiles(
      [
        { name: 'Night Alarm.en.vtt', format: 'Web Video Text Tracks' },
        { name: 'Night Alarm.ar.vtt' },
        { name: 'captions.srt' },
      ],
      identifier,
    );
    expect(tracks).toHaveLength(3);
    expect(tracks[0]).toMatchObject({
      language: 'en',
      format: 'vtt',
      url: 'https://archive.org/download/night-alarm/Night%20Alarm.en.vtt',
    });
    expect(tracks[1]!.language).toBe('ar');
    expect(tracks[2]!.language).toBe('und');
    expect(tracks[2]!.format).toBe('srt');
  });

  it('detects real-world asr caption variants by format field (live-verified patterns)', () => {
    const tracks = extractSubtitleTracksFromFiles(
      [
        { name: 'M4V10003.asr.srt', format: 'SubRip' },
        { name: 'someitem_master.intros.asr.vtt', format: 'Web Video Text Tracks' },
      ],
      identifier,
    );
    expect(tracks).toHaveLength(2);
    // .asr = automatic speech recognition, NOT a language code
    expect(tracks[0]).toMatchObject({ language: 'und', format: 'srt' });
    expect(tracks[1]).toMatchObject({ language: 'und', format: 'vtt' });
  });

  it('ignores non-subtitle files', () => {
    expect(extractSubtitleTracksFromFiles([{ name: 'movie.mp4' }], identifier)).toHaveLength(0);
  });
});
