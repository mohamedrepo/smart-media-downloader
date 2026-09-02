import { describe, expect, it } from 'vitest';
import {
  extensionFromUrl,
  isDirectMediaUrl,
  sanitizeFilename,
  subtitleFilename,
  validateMediaUrl,
} from '../src/utils/validation';

describe('validateMediaUrl', () => {
  it('accepts public http(s) URLs', () => {
    expect(validateMediaUrl('https://cdn.example.com/video.mp4')).toBe(
      'https://cdn.example.com/video.mp4',
    );
    expect(
      validateMediaUrl('http://media.example.org/path/file.webm?dl=1'),
    ).toBeTruthy();
  });

  it('rejects non-http schemes (code execution vectors)', () => {
    expect(validateMediaUrl('javascript:alert(1)')).toBeNull();
    expect(validateMediaUrl('data:text/html;base64,PGI+')).toBeNull();
    expect(validateMediaUrl('blob:https://a.com/x')).toBeNull();
    expect(validateMediaUrl('file:///C:/Windows/system32/drivers/etc/hosts')).toBeNull();
    expect(validateMediaUrl('chrome-extension://abc/x')).toBeNull();
  });

  it('rejects URLs with embedded credentials', () => {
    expect(validateMediaUrl('https://user:pass@example.com/file.mp4')).toBeNull();
  });

  it('rejects loopback, private networks, and internal hosts', () => {
    expect(validateMediaUrl('http://localhost/file.mp4')).toBeNull();
    expect(validateMediaUrl('http://127.0.0.1/file.mp4')).toBeNull();
    expect(validateMediaUrl('http://10.0.0.5/file.mp4')).toBeNull();
    expect(validateMediaUrl('http://192.168.1.10/file.mp4')).toBeNull();
    expect(validateMediaUrl('http://172.16.0.1/file.mp4')).toBeNull();
    expect(validateMediaUrl('http://169.254.1.1/file.mp4')).toBeNull();
    expect(validateMediaUrl('http://nas.local/file.mp4')).toBeNull();
    expect(validateMediaUrl('http://service.internal/file.mp4')).toBeNull();
    expect(validateMediaUrl('http://[::1]/file.mp4')).toBeNull();
  });

  it('rejects garbage and oversized input', () => {
    expect(validateMediaUrl('not a url')).toBeNull();
    expect(validateMediaUrl('')).toBeNull();
    expect(validateMediaUrl(`https://a.com/${'x'.repeat(9000)}`)).toBeNull();
  });
});

describe('sanitizeFilename', () => {
  it('strips path traversal', () => {
    const name = sanitizeFilename('../../..\\..\\windows/system32/evil');
    expect(name).not.toContain('..');
    expect(name).not.toContain('/');
    expect(name).not.toContain('\\');
  });

  it('removes Windows-illegal characters and control chars', () => {
    const name = sanitizeFilename('video: "final" <cut>? *.mp4\u0007');
    expect(name).not.toMatch(/[<>:"|?*\u0000-\u001f\u007f]/);
  });

  it('guards reserved device names', () => {
    expect(sanitizeFilename('CON')).toBe('_CON');
    expect(sanitizeFilename('nul.txt')).toBe('_nul.txt');
    expect(sanitizeFilename('com1')).toBe('_com1');
  });

  it('trims trailing dots and spaces (Windows requirement)', () => {
    expect(sanitizeFilename('movie. . ')).toBe('movie');
    expect(sanitizeFilename('  ...  ')).toBe('media-file');
  });

  it('caps length at 180 chars', () => {
    const name = sanitizeFilename('v'.repeat(300));
    expect(name.length).toBe(180);
  });

  it('falls back for empty results', () => {
    expect(sanitizeFilename('')).toBe('media-file');
    expect(sanitizeFilename('???')).toBe('media-file');
  });
});

describe('subtitleFilename', () => {
  it('builds "Title.lang.ext" names', () => {
    expect(subtitleFilename('My Video', 'en', 'srt')).toBe('My Video.en.srt');
    expect(subtitleFilename('My: Video', 'fr', 'vtt')).toBe('My Video.fr.vtt');
  });

  it('sanitizes unsafe titles and language codes', () => {
    expect(subtitleFilename('../../evil', 'en', 'srt')).not.toContain('..');
    const name = subtitleFilename('ok', 'en/../x', 'srt');
    expect(name).not.toContain('..');
  });
});

describe('isDirectMediaUrl / extensionFromUrl', () => {
  it('recognizes direct media extensions', () => {
    expect(isDirectMediaUrl('https://a.com/v/movie.mp4?token=1')).toBe(true);
    expect(isDirectMediaUrl('https://a.com/v/song.M4A')).toBe(true);
    expect(isDirectMediaUrl('https://a.com/page.html')).toBe(false);
    expect(isDirectMediaUrl('https://a.com/v/movie')).toBe(false);
  });

  it('extracts lowercase extensions', () => {
    expect(extensionFromUrl('https://a.com/Clip.MP4')).toBe('mp4');
    expect(extensionFromUrl('https://a.com/noext')).toBeNull();
  });
});
