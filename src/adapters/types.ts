/**
 * Adapter-level types shared by adapter implementations and the registry.
 */

import type { MediaInfo } from '../types';
import type { MediaProviderAdapter } from './provider-adapter-interface';

/** Result of adapter routing for a media URL. */
export interface AdapterResolution {
  adapter: MediaProviderAdapter;
  mediaInfo: MediaInfo;
}

/** Shared probe summary adapters receive from the download manager. */
export interface ProbeSummary {
  totalBytes?: number;
  contentType?: string;
  acceptsRanges: boolean;
}
