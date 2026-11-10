import { browser } from 'wxt/browser';
import type { Evidence, Seen } from './familiarity';

export type Protocol = 'openai' | 'anthropic';

export interface Settings {
  protocol: Protocol;
  baseUrl: string;
  apiKey: string;
  model: string;
}

/**
 * What Wisp writes on the page: a translation under every paragraph, or only
 * short notes on the expressions the reader probably does not know.
 */
export type Mode = 'translate' | 'learn';

export const DEFAULT_SETTINGS: Settings = {
  protocol: 'openai',
  baseUrl: '',
  apiKey: '',
  model: '',
};

export function isConfigured(settings: Settings): boolean {
  return Boolean(settings.baseUrl && settings.apiKey && settings.model);
}

export async function loadSettings(): Promise<Settings> {
  const stored = await browser.storage.local.get('settings');
  return { ...DEFAULT_SETTINGS, ...(stored.settings as Partial<Settings> | undefined) };
}

export async function saveSettings(settings: Settings): Promise<void> {
  await browser.storage.local.set({ settings });
}

export async function loadMode(): Promise<Mode> {
  const stored = await browser.storage.local.get('mode');
  return stored.mode === 'learn' ? 'learn' : 'translate';
}

export async function saveMode(mode: Mode): Promise<void> {
  await browser.storage.local.set({ mode });
}

/**
 * Whether Wisp is working. Like the mode, this is one switch for every page:
 * turned on in one tab, it stays on in the others and on pages opened later.
 */
export async function loadEnabled(): Promise<boolean> {
  const stored = await browser.storage.local.get('enabled');
  return stored.enabled === true;
}

export async function saveEnabled(enabled: boolean): Promise<void> {
  await browser.storage.local.set({ enabled });
}

/** Sites the reader has sent Wisp away from. It stays off there until called back. */
export async function loadMutedSites(): Promise<string[]> {
  const stored = await browser.storage.local.get('mutedSites');
  return Array.isArray(stored.mutedSites) ? (stored.mutedSites as string[]) : [];
}

export async function saveMutedSites(sites: string[]): Promise<void> {
  await browser.storage.local.set({ mutedSites: [...new Set(sites)] });
}

export async function setSiteMuted(site: string, muted: boolean): Promise<void> {
  const sites = (await loadMutedSites()).filter((each) => each !== site);
  await saveMutedSites(muted ? [...sites, site] : sites);
}

/** Calls back whenever one of the given stored values changes, in this tab or another. */
export function onStored(keys: string[], changed: () => void): void {
  browser.storage.local.onChanged.addListener((changes) => {
    if (keys.some((key) => key in changes)) changed();
  });
}

export const LEVELS = {
  cet4: '刚过大学英语四级，平时很少用英语',
  cet6: '过了大学英语六级，能慢慢读懂一般的英文文章',
  fluent: '能流畅阅读英文，只在生僻词、俚语和文化梗上卡住',
} as const;

export type Level = keyof typeof LEVELS;

/** What Wisp knows about the person it reads for. Both parts shape the prompts. */
export interface Reader {
  level: Level;
  /** Wishes the reader has voiced, in their own words: a tone, a term to keep, a thing to skip. */
  preferences: string[];
}

export async function loadReader(): Promise<Reader> {
  const stored = (await browser.storage.local.get('reader')).reader as Partial<Reader> | undefined;
  return {
    level: stored?.level && stored.level in LEVELS ? stored.level : 'cet4',
    preferences: Array.isArray(stored?.preferences) ? stored.preferences : [],
  };
}

export async function saveReader(reader: Reader): Promise<void> {
  const preferences = [...new Set(reader.preferences.map((line) => line.trim()).filter(Boolean))];
  await browser.storage.local.set({ reader: { level: reader.level, preferences } });
}

/** How an expression is written in the collection of known expressions, so that case and spacing do not matter. */
export function normalizePhrase(phrase: string): string {
  return phrase.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * The expressions the reader has marked as known, each with the note it
 * carried when it was put away (empty for ones added by hand). They are not
 * annotated again.
 */
export type Known = Record<string, string>;

export async function loadKnown(): Promise<Known> {
  const { known } = await browser.storage.local.get('known');
  // Before the notes were kept, this was a plain list of expressions.
  if (Array.isArray(known)) return Object.fromEntries(known.map((phrase: string) => [phrase, '']));
  return (known as Known | undefined) ?? {};
}

export async function saveKnown(known: Known): Promise<void> {
  await browser.storage.local.set({ known });
}

export async function addKnown(phrase: string, gloss = ''): Promise<void> {
  const key = normalizePhrase(phrase);
  if (key) await saveKnown({ ...(await loadKnown()), [key]: gloss });
}

export async function removeKnown(phrase: string): Promise<void> {
  const known = await loadKnown();
  delete known[normalizePhrase(phrase)];
  await saveKnown(known);
}

/** How often each note has been read past; see familiarity.ts. */
export async function loadSeen(): Promise<Seen> {
  return ((await browser.storage.local.get('seen')).seen as Seen | undefined) ?? {};
}

export async function saveSeen(seen: Seen): Promise<void> {
  await browser.storage.local.set({ seen });
}

/** What the reader has done with notes since their level was last set; see familiarity.ts. */
export async function loadEvidence(): Promise<Evidence> {
  const stored = (await browser.storage.local.get('evidence')).evidence as Evidence | undefined;
  return stored ?? { level: 'cet4', known: 0, stuck: 0 };
}

export async function saveEvidence(evidence: Evidence): Promise<void> {
  await browser.storage.local.set({ evidence });
}
