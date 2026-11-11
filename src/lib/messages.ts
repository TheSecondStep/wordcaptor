import type { Mode } from './settings';

/**
 * What the model is asked to do with a batch of segments: one of the two
 * modes of reading a page, or making subtitles of a video's automatic
 * captions.
 */
export type Task = Mode | 'captions';

/** One-shot requests the content script sends to the background worker. */
export type Request =
  | { type: 'brief'; title: string; text: string }
  /** Asks for saved model output for these texts. The reply has one entry per text, null where none is saved. */
  | { type: 'cached'; mode: Task; texts: string[] }
  /** Asks what the selected words mean where they stand. The reply is a sentence or two. */
  | { type: 'explain'; selection: string; paragraph: string; title: string }
  /** Something the reader said to the sprite. The reply is a Command, already applied to what is stored. */
  | { type: 'command'; said: string; brief: string; site: string }
  /** Asks for the handwriting font to be made available in the frame that sends this. */
  | { type: 'load-font' }
  | { type: 'open-options' };

export interface Failure {
  ok: false;
  error: string;
  notConfigured?: boolean;
  /** `rate` waits, `once` tries the current stretch again immediately, `stop` does not try again. */
  retry?: 'rate' | 'once' | 'stop';
  /** How long a `rate` failure asks the caller to wait before sending anything else. */
  retryAfterMs?: number;
}

export type Reply<T> = { ok: true; value: T } | Failure;

/**
 * Model work on a batch runs over a port so segments can arrive one by one.
 * The content script opens a port with this name, posts one TranslateRequest,
 * and receives TranslateEvents until `end`.
 */
export const TRANSLATE_PORT = 'wisp:translate';

export interface TranslateRequest {
  mode: Task;
  brief: string;
  context: string;
  segments: string[];
  /**
   * Who this is for, when the model is busy. Subtitles are 1 and run before the page, which is 0.
   * Something the reader just asked is higher still, and is set by the background.
   */
  priority?: number;
}

export type TranslateEvent =
  /**
   * In translate mode `text` is the translation; in learn mode it is the segment's annotation lines, possibly
   * none; for captions it is the segment as subtitle lines.
   */
  | { type: 'segment'; index: number; text: string }
  | { type: 'end'; failure?: Failure };

/** Sent from the background worker to a tab when the user clicks the toolbar icon or presses the shortcut. */
export const TOGGLE_MESSAGE = 'wisp:toggle';
