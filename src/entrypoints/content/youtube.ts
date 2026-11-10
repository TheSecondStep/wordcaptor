import type { Failure, Task, TranslateRequest } from '@/lib/messages';
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
const SPOKEN_BATCH = 2;
/** Two calls at once, so that after a seek the passage under the playhead does not wait behind another. */
const MAX_CALLS = 2;
const CONTEXT_CHARS = 200;
/** After the model fails, how long to leave it alone before asking again. */
const RETRY_AFTER_MS = 30_000;
const PLAYER_SELECTOR = '#movie_player';
/** Set on the player while Wisp shows the subtitles, so that YouTube's own are hidden; see style.css. */
const ACTIVE_CLASS = 'wisp-subtitled';

export interface SubtitleHost {
  isActive(): boolean;
  translate(request: TranslateRequest, onSegment: (index: number, text: string) => void): Promise<Failure | null>;
  /** Answers saved earlier for these texts, in the same order, with null for the ones there are none for. */
  cached(task: Task, texts: string[]): Promise<(string | null)[]>;
  /** The translated line is written in the same hand as translations on pages. */
  loadFont(): void;
}

/**
 * On a YouTube video with English captions turned on, shows each caption with
 * its translation underneath, in place of YouTube's own.
 *
 * The captions are the ones the player itself has loaded: its request is seen
 * in the page's resource timings and repeated, since the address carries a
 * token that cannot be made up. So nothing happens until the viewer turns
 * captions on.
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
  let retryAt = 0;
  let calls = 0;
  let video: HTMLVideoElement | null = null;

  const captionRequests = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) if (entry.name.includes('/api/timedtext')) void load(entry.name);
  });
  captionRequests.observe({ type: 'resource', buffered: true });

  // Timings of a video's captions must not leak into the next video opened in the same tab.
  document.addEventListener('yt-navigate-start', reset);
  document.addEventListener('timeupdate', tick, true);

  function reset() {
    trackUrl = '';
    passages = [];
    answered = new Map();
    hide();
  }

  function hide() {
    overlay?.remove();
    overlay = null;
    shown = '';
    document.querySelector(PLAYER_SELECTOR)?.classList.remove(ACTIVE_CLASS);
  }

  async function load(url: string) {
    const address = new URL(url);
    // Only English captions, and not ones YouTube has machine-translated from another language.
    if (!address.searchParams.get('lang')?.startsWith('en') || address.searchParams.has('tlang')) {
      reset();
      return;
    }
    address.searchParams.set('fmt', 'json3');
    if (address.href === trackUrl) return;
    trackUrl = address.href;
    try {
      const track = (await (await fetch(address)).json()) as { events?: CaptionEvent[] };
      if (trackUrl !== address.href) return; // another track was chosen meanwhile
      const automatic = address.searchParams.get('kind') === 'asr';
      const loaded = toPassages(track.events ?? [], automatic);
      const loadedTask: Task = automatic ? 'captions' : 'translate';
      const saved = await cached(
        loadedTask,
        loaded.map((passage) => passage.text),
      );
      if (trackUrl !== address.href) return;
      // All at once, so that no passage is asked for before it is known whether it was saved.
      task = loadedTask;
      passages = loaded;
      answered = new Map(
        saved.flatMap((answer, index) => (answer ? [[index, withTranslation(loaded[index]!, answer)] as const] : [])),
      );
      // A paused video does not tick, and may be waiting for its captions.
      show();
    } catch {
      reset();
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
    if (!video || !player?.contains(video)) return;
    // YouTube's own captions being off means the viewer does not want any.
    const captionsOn = player.querySelector('.ytp-subtitles-button')?.getAttribute('aria-pressed') === 'true';
    if (!isActive() || passages.length === 0 || !captionsOn) {
      hide();
      return;
    }

    const time = video.currentTime;
    const index = cueAt(passages, time);
    // Between two passages, the next one is where the viewer is headed.
    const upcoming = index !== -1 ? index : passages.findIndex((passage) => passage.start > time);
    if (upcoming !== -1) request(upcoming, time);

    const cues = answered.get(index) ?? passages[index]?.cues ?? [];
    const cue = cues[cueAt(cues, time)];
    const state = cue ? `${cue.text}\n${cue.translation ?? ''}` : '';
    if (state === shown && overlay) return;
    shown = state;

    if (!overlay) {
      overlay = document.createElement('div');
      overlay.className = 'wisp-subtitle';
      overlay.append(document.createElement('span'), document.createElement('span'));
      player.append(overlay);
      player.classList.add(ACTIVE_CLASS);
      loadFont();
    }
    overlay.hidden = !cue;
    overlay.children[0]!.textContent = cue?.text ?? '';
    overlay.children[1]!.textContent = cue?.translation ?? '';
  }

  /** Keeps the passages from this one on, as far ahead as translation runs, answered or on their way. */
  function request(index: number, time: number) {
    const size = task === 'captions' ? SPOKEN_BATCH : WRITTEN_BATCH;
    const wanted = (at: number) => at < passages.length && !answered.has(at) && passages[at]!.start <= time + AHEAD_SECONDS;
    while (calls < MAX_CALLS && Date.now() >= retryAt) {
      let from = index;
      while (answered.has(from)) from++;
      if (!wanted(from)) return;
      let to = from + 1;
      while (to < from + size && wanted(to)) to++;
      send(from, passages.slice(from, to));
    }
  }

  function send(from: number, batch: Passage[]) {
    batch.forEach((_, offset) => answered.set(from + offset, null));
    const track = trackUrl;
    const written = '\n这是视频字幕：口语，句子常被切成几段。每段各自译成一行简短的中文字幕，不要把相邻的段合并。';
    calls++;
    void translate(
      {
        mode: task,
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
    ).then((failure) => {
      calls--;
      if (track !== trackUrl) return;
      if (!failure) {
        // Room for the next call, which a paused video would not ask for by itself.
        show();
        return;
      }
      // What the failed call left unanswered is asked for again, but not right away. A passage the
      // model skipped in a call that went well is not: it would likely skip it again, at a cost.
      retryAt = Date.now() + RETRY_AFTER_MS;
      batch.forEach((_, offset) => answered.get(from + offset) === null && answered.delete(from + offset));
    });
  }
}
