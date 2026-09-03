/**
 * Adapter registry — routes a media URL to the first adapter that can
 * handle it. Adding support for a new authorized provider means adding
 * one file implementing MediaProviderAdapter and registering it here.
 *
 * Routing order matters: specific adapters first, DirectMediaAdapter last
 * (it is the generic fallback for plain file URLs).
 */

import type { MediaProviderAdapter } from './provider-adapter-interface';
import { DirectMediaAdapter } from './direct-media-adapter';
import { InternetArchiveAdapter } from './internet-archive-adapter';

const registry: MediaProviderAdapter[] = [
  // Authorized-provider adapters register ABOVE the direct adapter.
  // Internet Archive: documented public metadata API + official /download/
  // endpoints; access-restricted lending items are refused.
  new InternetArchiveAdapter(),
  new DirectMediaAdapter(),
];

export function findAdapter(url: string): MediaProviderAdapter | null {
  for (const adapter of registry) {
    if (adapter.canHandle(url)) return adapter;
  }
  return null;
}

export function listAdapters(): readonly MediaProviderAdapter[] {
  return registry;
}
