import { chooseCaption, type ListedCaption } from '@/lib/caption-choice';
import { defineContentScript } from 'wxt/utils/define-content-script';

interface Player {
  getAudioTrack?: () => { captionTracks?: ListedCaption[] };
}

/**
 * The address in the watch-page data has no proof-of-origin token, and fetching
 * it returns an empty body. Once the player has initialized the audio track, the
 * same captions are listed again with that token. A token-bearing address still
 * comes back empty unless the request names the web client, `c=WEB`.
 * Creator-uploaded Chinese is used as-is. Otherwise uploaded English, then automatic English.
 * The chosen address is left on the document for the isolated content script.
 */
export default defineContentScript({
  matches: ['*://www.youtube.com/*'],
  runAt: 'document_start',
  world: 'MAIN',
  main() {
    let timer = 0;

    const publish = () => {
      const chosen = chooseCaption(collect(), clientName());
      if (!chosen) return;
      const root = document.documentElement;
      if (root.dataset.wispTrack !== chosen.url) {
        root.dataset.wispTrack = chosen.url;
        document.dispatchEvent(new CustomEvent('wisp-track'));
      }
      if (chosen.settled) window.clearInterval(timer);
    };

    const watch = () => {
      window.clearInterval(timer);
      const until = Date.now() + 15_000;
      timer = window.setInterval(() => {
        publish();
        if (Date.now() > until) window.clearInterval(timer);
      }, 250);
    };

    publish();
    document.addEventListener('DOMContentLoaded', publish);
    document.addEventListener('yt-navigate-start', () => {
      delete document.documentElement.dataset.wispTrack;
      watch();
    });
    document.addEventListener('yt-navigate-finish', publish);
    watch();
  },
});

function collect(): ListedCaption[] {
  const listed =
    (
      window as Window & {
        ytInitialPlayerResponse?: {
          captions?: { playerCaptionsTracklistRenderer?: { captionTracks?: ListedCaption[] } };
        };
      }
    ).ytInitialPlayerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
  const live = (document.querySelector('#movie_player') as Player | null)?.getAudioTrack?.()?.captionTracks ?? [];
  return [...live, ...listed];
}

function clientName(): string {
  const name = (window as Window & { ytcfg?: { get?: (key: string) => unknown } }).ytcfg?.get?.('INNERTUBE_CLIENT_NAME');
  return typeof name === 'string' && name ? name : 'WEB';
}
