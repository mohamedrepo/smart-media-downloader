import { useCallback, useEffect, useState } from 'react';
import type { MediaInfo, SubtitleTrack } from '../../types';

interface DetectionResult {
  media: MediaInfo[];
  subtitleTracks: SubtitleTrack[];
  detectedEme: boolean;
}

/**
 * Media detection for the active tab.
 * Asks the tab's content script directly (GET_MEDIA), which keeps the
 * popup decoupled from background caching. Falls back to an empty result
 * for pages without the content script (chrome:// pages, PDFs, etc.).
 */
export function useTabMedia(): {
  media: MediaInfo[];
  subtitleTracks: SubtitleTrack[];
  emeDetected: boolean;
  loading: boolean;
  supportedTab: boolean;
  rescan: () => void;
} {
  const [state, setState] = useState<DetectionResult>({
    media: [],
    subtitleTracks: [],
    detectedEme: false,
  });
  const [loading, setLoading] = useState(true);
  const [supportedTab, setSupportedTab] = useState(true);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    void (async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!alive) return;
        const url = tab?.url ?? '';
        const injectable =
          url.startsWith('http://') || url.startsWith('https://');
        if (!injectable || tab?.id === undefined) {
          setSupportedTab(false);
          setState({ media: [], subtitleTracks: [], detectedEme: false });
          return;
        }
        setSupportedTab(true);
        const res = (await chrome.tabs.sendMessage(tab.id, {
          type: 'GET_MEDIA',
        })) as DetectionResult | undefined;
        if (!alive) return;
        setState({
          media: res?.media ?? [],
          subtitleTracks: res?.subtitleTracks ?? [],
          detectedEme: res?.detectedEme ?? false,
        });
      } catch {
        if (alive) {
          setSupportedTab(false);
          setState({ media: [], subtitleTracks: [], detectedEme: false });
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [tick]);

  const rescan = useCallback((): void => setTick((t) => t + 1), []);

  return {
    media: state.media,
    subtitleTracks: state.subtitleTracks,
    emeDetected: state.detectedEme,
    loading,
    supportedTab,
    rescan,
  };
}
