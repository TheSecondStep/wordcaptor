/** One caption track as the watch page or the player lists it. */
export interface ListedCaption {
  baseUrl?: string;
  url?: string;
  languageCode?: string;
  kind?: string;
}

/** The caption address to fetch. `native` means the line is already Chinese and is not sent to a model. */
export interface ChosenCaption {
  url: string;
  pot: boolean;
  written: boolean;
  lang: string;
  native: boolean;
  /**
   * No better track is still waiting on a token. Official simplified Chinese outranks
   * other written Chinese, which outranks written English, which outranks automatic English.
   */
  settled: boolean;
}

interface Candidate {
  url: string;
  pot: boolean;
  written: boolean;
  lang: string;
  native: boolean;
  rank: number;
}

/**
 * Picks a caption address. A creator-uploaded Chinese track is used as-is.
 * Otherwise a creator-uploaded English track, and only then automatic English.
 * Tracks that already carry a proof-of-origin token are the only ones considered
 * once any of them has a token, because a listed address without one comes back empty.
 */
export function chooseCaption(tracks: ListedCaption[], client = 'WEB'): ChosenCaption | null {
  const usable = tracks.flatMap((track) => candidate(track, client));
  if (usable.length === 0) return null;
  const pool = usable.some((track) => track.pot) ? usable.filter((track) => track.pot) : usable;
  pool.sort((a, b) => a.rank - b.rank);
  const chosen = pool[0]!;
  const best = Math.min(...usable.map((track) => track.rank));
  return {
    url: chosen.url,
    pot: chosen.pot,
    written: chosen.written,
    lang: chosen.lang,
    native: chosen.native,
    settled: chosen.pot && chosen.rank === best,
  };
}

function candidate(track: ListedCaption, client: string): Candidate[] {
  const raw = track.url || track.baseUrl;
  if (!raw || raw.includes('tlang=')) return [];
  let address: URL;
  try {
    address = new URL(raw, 'https://www.youtube.com');
  } catch {
    return [];
  }
  const lang = track.languageCode || address.searchParams.get('lang') || '';
  const written = track.kind !== 'asr';
  const rank = captionRank(lang, written);
  if (rank === null || !address.hostname.endsWith('youtube.com') || !address.pathname.startsWith('/api/timedtext')) return [];
  if (!address.searchParams.get('lang')) address.searchParams.set('lang', lang);
  if (!written && !address.searchParams.get('kind')) address.searchParams.set('kind', 'asr');
  const pot = address.searchParams.has('pot');
  address.searchParams.set('fmt', 'json3');
  if (pot && !address.searchParams.has('c')) address.searchParams.set('c', client || 'WEB');
  return [{ url: address.href, pot, written, lang, native: written && lang.startsWith('zh'), rank }];
}

/** Lower is better. Automatic captions in a language other than English are not used. */
function captionRank(lang: string, written: boolean): number | null {
  if (written && simplifiedChinese(lang)) return 0;
  if (written && lang.startsWith('zh')) return 1;
  if (written && lang.startsWith('en')) return 2;
  if (lang.startsWith('en')) return 3;
  return null;
}

function simplifiedChinese(lang: string): boolean {
  const code = lang.toLowerCase();
  return code === 'zh' || code.startsWith('zh-hans') || code.startsWith('zh-cn') || code.startsWith('zh-sg');
}
