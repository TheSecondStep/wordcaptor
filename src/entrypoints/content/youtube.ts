import type { Failure, Task, TranslateRequest } from '@/lib/messages';
import { IDLE_PACE, PRIORITY, afterSubtitleFailure, nextCueBatch, type SubtitlePace } from '@/lib/pace';
import { onStored } from '@/lib/settings';
import { cueAt, toPassages, withTranslation, type CaptionEvent, type Cue, type Passage } from '@/lib/subtitles';

/**
 * Translation runs ahead of the video the way the video itself buffers: this
 * many seconds past the playhead are kept translated. A video that is paused
 * or abandoned costs nothing more, and a seek only waits for one call.
 */
const AHEAD_SECONDS = 180;
/**
 * How many passages go to the model in one call. Written captions are a line
 * each. A passage of automatic captions is half a minute of speech, and the
 * viewer may be waiting for the first one.
 */
const WRITTEN_BATCH = 20;
/** The first written call is only the opening, so that line can return before the rest of the buffer. */
const OPENING_LINES = 4;
const SPOKEN_BATCH = 2;
/** Two calls at once, so that after a seek the passage under the playhead does not wait behind another. */
const MAX_CALLS = 2;
const CONTEXT_CHARS = 200;
const PLAYER_SELECTOR = '#movie_player';
/** Set on the player while Wordcaptor shows the subtitles, so that YouTube's own are hidden; see style.css. */
const ACTIVE_CLASS = 'wisp-subtitled';

export interface SubtitleHost {
  isActive(): boolean;
  translate(
    request: TranslateRequest,
    onSegment: (index: number, text: string) => void,
  ): Promise<Failure | null> & { cancel: () => void };
  /** Answers saved earlier for these texts, in the same order, with null for the ones there are none for. */
  cached(task: Task, texts: string[]): Promise<(string | null)[]>;
  /** The translated line is written in the same hand as translations on pages. */
  loadFont(): void;
}

/**
 * On a YouTube video with English captions turned on, shows each caption with
 * its translation underneath, in place of YouTube's own.
 *
 * The track is the player's own English address once that address carries a
 * token: a track a person wrote, or the automatic track when that is all there
 * is. The page's listing has no token and usually comes back empty, so it is
 * only tried until the player's address appears. The opening lines are sent
 * off then, without waiting for playback. An empty answer is ignored.
 * Nothing is sent until the viewer has English captions turned on.
 *
 * Captions written by a person are translated line by line. Automatic ones
 * are words without sentences: the model makes sentences of them and
 * translates those, and until it has, the words are shown as they come.
 *
 * Every answer is saved under the text it is for, so watching a video again,
 * or going back in it, asks the model for nothing.
 */
export function watchSubtitles({ isActive, translate, cached, loadFont }: SubtitleHost): void {
  if (location.hostname !== 'www.youtube.com' || window !== window.top) return;

  let trackUrl = '';
  let task: Task = 'translate';
  let passages: Passage[] = [];
  /** What the model made of each passage, by index. A passage it is working on holds null. */
  let answered = new Map<number, Cue[] | null>();
  let overlay: HTMLElement | null = null;
  /** The two lines the overlay shows. */
  let shown = '';
  let retry: SubtitlePace = { ...IDLE_PACE };
  let calls = 0;
  /** Bumped when a rate limit lands, so a batch already sent for the old playhead is dropped. */
  let generation = 0;
  const flights = new Set<{ cancel: () => void }>();
  let resume: ReturnType<typeof setTimeout> | undefined;
  /** The last playhead seen, so a jump backward can ask again for lines that had been stepped over. */
  let seenAt = 0;
  let video: HTMLVideoElement | null = null;
  /** The first written batch has been sized to the opening. */
  let primed = false;
  /** Creator-uploaded Chinese is already the line the viewer reads, so it is not sent to a model. */
  let native = false;
  /** Addresses that came back empty, so the player's own request is not blocked and this one is not fetched again. */
  const emptyTracks = new Set<string>();

  // A new key is the one thing that makes a rejected key worth trying again.
  onStored(['settings'], () => {
    retry = { ...IDLE_PACE };
    show();
  });

  const captionRequests = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) if (entry.name.includes('/api/timedtext')) void load(entry.name);
  });
  captionRequests.observe({ type: 'resource', buffered: true });

  // Timings of a video's captions must not leak into the next video opened in the same tab.
  document.addEventListener('yt-navigate-start', reset);
  document.addEventListener('wisp-track', warmStart);
  document.addEventListener('timeupdate', tick, true);
  watchCaptionButton();
  warmStart();

  function reset() {
    trackUrl = '';
    passages = [];
    answered = new Map();
    retry = { ...IDLE_PACE };
    seenAt = 0;
    primed = false;
    native = false;
    emptyTracks.clear();
    clearTimeout(resume);
    hide();
  }

  /** The track the page world chose: uploaded Chinese, else English. */
  function listedTrack(): string | null {
    const url = document.documentElement.dataset.wispTrack;
    if (!url) return null;
    try {
      const address = new URL(url);
      if (!address.hostname.endsWith('youtube.com') || !address.pathname.startsWith('/api/timedtext')) return null;
      return address.href;
    } catch {
      return null;
    }
  }

  function warmStart() {
    const url = listedTrack();
    if (url) void load(url);
  }

  /** Turning captions on after the track is already loaded has to start the opening. */
  function watchCaptionButton() {
    const seen = new WeakSet<Element>();
    const dom = new MutationObserver(bind);
    function bind() {
      const player = document.querySelector(PLAYER_SELECTOR);
      if (player && !seen.has(player)) {
        seen.add(player);
        new MutationObserver(() => show()).observe(player, { subtree: true, attributes: true, attributeFilter: ['aria-pressed'] });
      }
      if (player) dom.disconnect();
      show();
    }
    bind();
    dom.observe(document.documentElement, { childList: true, subtree: true });
    document.addEventListener('yt-navigate-finish', () => {
      dom.observe(document.documentElement, { childList: true, subtree: true });
      bind();
    });
  }

  /** Same caption track, even when the player adds a token the page listing did not have. */
  function trackIdentity(url: string): string {
    const params = new URL(url).searchParams;
    return `${params.get('v') ?? ''}\n${params.get('lang') ?? ''}\n${params.get('kind') ?? ''}`;
  }

  function hide() {
    overlay?.remove();
    overlay = null;
    shown = '';
    document.querySelector(PLAYER_SELECTOR)?.classList.remove(ACTIVE_CLASS);
  }

  async function load(url: string) {
    const address = new URL(url);
    const lang = address.searchParams.get('lang');
    // A track list has no language. It is not a choice of captions.
    if (!lang) return;
    // Only English, or Chinese a person uploaded. A machine translation of another language is not a source.
    const uploadedChinese = lang.startsWith('zh') && address.searchParams.get('kind') !== 'asr';
    if ((!lang.startsWith('en') && !uploadedChinese) || address.searchParams.has('tlang')) {
      reset();
      return;
    }
    address.searchParams.set('fmt', 'json3');
    // A token-bearing address is still empty unless the request names the web client.
    if (address.searchParams.has('pot') && !address.searchParams.has('c')) address.searchParams.set('c', 'WEB');
    if (emptyTracks.has(address.href)) return;
    if (trackUrl && trackIdentity(address.href) === trackIdentity(trackUrl) && passages.length > 0) return;
    if (address.href === trackUrl) return;
    const mine = address.href;
    trackUrl = mine;
    try {
      const track = (await (await fetch(address)).json()) as { events?: CaptionEvent[] };
      if (trackUrl !== mine) return; // another track was chosen meanwhile
      const automatic = address.searchParams.get('kind') === 'asr';
      const loaded = toPassages(track.events ?? [], automatic);
      // The address on the page often has no token and comes back empty. Wait for the player's copy.
      if (loaded.length === 0) {
        emptyTracks.add(mine);
        if (trackUrl === mine) trackUrl = '';
        return;
      }
      if (uploadedChinese) {
        native = true;
        task = 'translate';
        passages = loaded;
        answered = new Map(loaded.map((passage, index) => [index, passage.cues]));
        show();
        return;
      }
      native = false;
      const loadedTask: Task = automatic ? 'captions' : 'translate';
      const saved = await cached(
        loadedTask,
        loaded.map((passage) => passage.text),
      );
      if (trackUrl !== mine) return;
      // All at once, so that no passage is asked for before it is known whether it was saved.
      task = loadedTask;
      passages = loaded;
      answered = new Map(
        saved.flatMap((answer, index) => (answer ? [[index, withTranslation(loaded[index]!, answer)] as const] : [])),
      );
      // A paused video does not tick. The opening is requested anyway.
      show();
    } catch {
      if (trackUrl !== mine) return;
      reset();
      emptyTracks.add(mine);
    }
  }

  function tick(event: Event) {
    const player = document.querySelector<HTMLElement>(PLAYER_SELECTOR);
    if (!(event.target instanceof HTMLVideoElement) || !player?.contains(event.target)) return;
    video = event.target;
    show();
  }

  /** Brings the overlay in line with where the video is and what has been translated. */
  function show() {
    const player = document.querySelector<HTMLElement>(PLAYER_SELECTOR);
    if (!isActive() || passages.length === 0) {
      hide();
      return;
    }
    // YouTube's own captions being off means the viewer does not want any.
    const captionsOn = player?.querySelector('.ytp-subtitles-button')?.getAttribute('aria-pressed') === 'true';
    if (!captionsOn) {
      hide();
      return;
    }

    if ((!video || !player?.contains(video)) && player) {
      const found = player.querySelector('video');
      if (found instanceof HTMLVideoElement) video = found;
    }
    const time = video?.currentTime ?? 0;
    const index = video ? cueAt(passages, time) : 0;
    // Between two passages, the next one is where the viewer is headed.
    const upcoming = index !== -1 ? index : passages.findIndex((passage) => passage.start > time);
    if (upcoming !== -1) request(upcoming, time);
    if (!video || !player?.contains(video)) return;

    const cues = cuesOnScreen(index);
    const cue = cues[cueAt(cues, time)];
    const state = cue ? `${cue.text}\n${cue.translation ?? ''}` : '';
    if (state === shown && overlay) return;
    shown = state;

    if (!cue) {
      if (overlay) overlay.hidden = true;
      player.classList.remove(ACTIVE_CLASS);
      shown = '';
      return;
    }
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.className = 'wisp-subtitle';
      overlay.append(document.createElement('span'), document.createElement('span'));
      player.append(overlay);
      loadFont();
    }
    player.classList.add(ACTIVE_CLASS);
    overlay.hidden = false;
    overlay.children[0]!.textContent = cue.text;
    overlay.children[1]!.textContent = cue.translation ?? '';
  }

  /**
   * What to put on screen for the passage under the playhead.
   * While a video is playing and the translation is not here yet, the original
   * stays up: a blank caption is worse than reading the line in English.
   * YouTube's own captions are left in place until this overlay actually shows a line.
   * A paused video can wait, and then the original and the translation appear together.
   * Automatic captions are words until the model has made sentences of them.
   */
  function cuesOnScreen(index: number): Cue[] {
    if (index < 0) return [];
    const ready = answered.get(index);
    if (ready) return ready;
    const raw = passages[index]?.cues ?? [];
    if (task === 'captions') return raw;
    if ((video && !video.paused && !video.ended) || retry.halted || index < retry.skipBefore) return raw;
    return [];
  }

  /**
   * Keeps the passages from the playhead on translated. A line the video has
   * already passed is not sent: the batch is chosen from where the video is
   * now, not from where it was when an earlier call failed.
   */
  function request(index: number, time: number) {
    if (native) return;
    if (time + 1 < seenAt) retry = { ...retry, skipBefore: 0, onceFrom: -1 };
    seenAt = time;
    if (retry.halted || Date.now() < retry.retryAt) return;
    while (calls < MAX_CALLS) {
      const size = task === 'captions' ? SPOKEN_BATCH : primed ? WRITTEN_BATCH : OPENING_LINES;
      primed = true;
      const span = nextCueBatch(
        passages.map((passage) => passage.start),
        (at) => answered.has(at),
        index,
        time,
        AHEAD_SECONDS,
        size,
        retry.skipBefore,
      );
      if (!span) return;
      send(span.from, passages.slice(span.from, span.to));
    }
  }

  function send(from: number, batch: Passage[]) {
    batch.forEach((_, offset) => answered.set(from + offset, null));
    const track = trackUrl;
    const written = '\n这是视频字幕：口语，句子常被切成几段。每段各自译成一行简短的中文字幕，不要把相邻的段合并。';
    calls++;
    const mine = generation;
    const flight = translate(
      {
        mode: task,
        priority: PRIORITY.subtitle,
        brief: `标题：${document.title}${task === 'translate' ? written : ''}`,
        context: (passages[from - 1]?.text ?? '').slice(-CONTEXT_CHARS),
        segments: batch.map((passage) => passage.text),
      },
      (offset, answer) => {
        if (track !== trackUrl) return;
        answered.set(from + offset, withTranslation(batch[offset]!, answer));
        // A paused video does not tick, and its cue is waiting for exactly this.
        show();
      },
    );
    flights.add(flight);
    void flight.then((failure) => {
      calls--;
      flights.delete(flight);
      // Whatever this call did not finish goes back into line. Where it sits is decided by the
      // playhead when the next batch is chosen, so a line that has since played is not sent again.
      if (track === trackUrl) batch.forEach((_, offset) => answered.get(from + offset) === null && answered.delete(from + offset));
      if (mine !== generation || track !== trackUrl) return;
      if (!failure) {
        retry = { ...retry, onceFrom: -1 };
        show();
        return;
      }
      // A limit on the key applies to every batch, including one already sent for the old position.
      if (failure.retry === 'rate') {
        generation++;
        for (const other of flights) other.cancel();
      }
      retry = afterSubtitleFailure(retry, failure, from, batch.length, Date.now());
      // A paused video does not tick, so the wait has to wake the subtitles itself.
      clearTimeout(resume);
      resume = setTimeout(show, Math.max(0, retry.retryAt - Date.now()));
    });
  }
}
