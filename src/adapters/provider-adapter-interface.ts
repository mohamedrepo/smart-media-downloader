/**
 * Provider adapter contract.
 *
 * An adapter encapsulates everything specific to ONE class of media
 * source. Adapters are the ONLY place allowed to know how a particular
 * source exposes media — and they may only use mechanisms that are
 * publicly documented, user-visible, and explicitly authorized:
 *
 *  - direct file URLs served by the site itself,
 *  - official download endpoints the site provides to users,
 *  - subtitle tracks the page exposes to the browser.
 *
 * Adapters must NEVER: bypass DRM or encryption, access content behind
 * authentication the user hasn't established themselves, reverse-engineer
 * private APIs, or circumvent any access control. If a source does not
 * expose an authorized mechanism, getAuthorizedDownloadUrl returns null
 * and the UI shows the protected-content notice instead.
 */

import type { MediaFormat, MediaInfo, SubtitleTrack } from '../types';

export interface MediaProviderAdapter {
  /** Unique, human-readable adapter name. */
  readonly name: string;

  /**
   * Whether this adapter can plausibly handle the given URL/page.
   * Must be cheap and synchronous (used for routing, not fetching).
   */
  canHandle(url: string): boolean;

  /** Resolve full media information for the resource. */
  getMediaInfo(url: string): Promise<MediaInfo>;

  /** Enumerate legitimately available format variants. */
  getAvailableFormats(mediaInfo: MediaInfo): Promise<MediaFormat[]>;

  /** Enumerate officially exposed subtitle tracks, when supported. */
  getSubtitleTracks?(mediaInfo: MediaInfo): Promise<SubtitleTrack[]>;

  /**
   * Return the authorized download URL for a format, or null when no
   * authorized mechanism exists. Returning null MUST be treated by the UI
   * as "cannot download" — never as "try harder".
   */
  getAuthorizedDownloadUrl(format: MediaFormat): Promise<string | null>;
}
