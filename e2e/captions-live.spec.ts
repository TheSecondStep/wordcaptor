import path from 'node:path';
import { chromium, expect, test, type Page } from '@playwright/test';
import { CAPTION_VIDEOS } from './caption-videos';

const EXTENSION_DIR = path.resolve(import.meta.dirname, '../.output/chrome-mv3');

interface CaptionReport {
  video: string;
  ok: boolean;
  title: string;
  author: string;
  lang: string;
  kind: string;
  events: number;
  officialChinese: boolean;
  error: string;
}

/**
 * Opens real watch pages with the extension loaded and checks the caption
 * address it publishes. Set WISP_CAPTION_LIVE=1. No model is configured, so
 * nothing is translated.
 */
test('every saved video yields a caption body', async () => {
  test.skip(!process.env.WISP_CAPTION_LIVE, 'set WISP_CAPTION_LIVE=1');
  test.setTimeout(CAPTION_VIDEOS.length * 45_000);

  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: false,
    args: [`--disable-extensions-except=${EXTENSION_DIR}`, `--load-extension=${EXTENSION_DIR}`],
  });
  const page = await context.newPage();
  const rows: CaptionReport[] = [];
  try {
    for (const video of CAPTION_VIDEOS) {
      rows.push(await readCaptions(page, video));
    }
  } finally {
    await context.close();
  }

  const failed = rows.filter((row) => !row.ok);
  console.log(rows.map((row) => `${row.ok ? 'ok' : 'FAIL'}\t${row.lang || '-'}${row.kind === 'asr' ? ' asr' : ''}\t${row.events}\t${row.officialChinese ? '官方中文' : '英文'}\t${row.author}\t${row.title}\t${row.error}`).join('\n'));
  expect(failed, failed.map((row) => `${row.video} ${row.error}`).join('\n')).toEqual([]);
});

async function readCaptions(page: Page, video: string): Promise<CaptionReport> {
  const blank = (error: string): CaptionReport => ({ video, ok: false, title: '', author: '', lang: '', kind: '', events: 0, officialChinese: false, error });
  try {
    await page.goto(video, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    const consent = page.getByRole('button', { name: /Reject all|Accept all|全部拒绝|全部接受/ });
    if (await consent.first().isVisible().catch(() => false)) await consent.first().click();
    return await page.evaluate(async () => {
      const started = Date.now();
      let published = '';
      while (Date.now() - started < 20_000) {
        published = document.documentElement.dataset.wispTrack ?? '';
        const zhPot = listedTracks().some((track) => officialChinese(track) && addressOf(track).includes('pot='));
        const lang = published ? new URL(published, location.href).searchParams.get('lang') ?? '' : '';
        if (published.includes('pot=') && (!zhPot || lang.startsWith('zh'))) break;
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      const tracks = listedTracks();
      const official = tracks.some((track) => officialChinese(track) && addressOf(track).includes('pot='));
      const details = playerResponse()?.videoDetails;
      const address = published ? new URL(published, location.href) : null;
      let events = 0;
      let error = published ? '' : '没有字幕地址';
      if (published) {
        try {
          const text = await (await fetch(published)).text();
          events = (JSON.parse(text) as { events?: unknown[] }).events?.length ?? 0;
          if (events === 0) error = '字幕正文是空的';
        } catch (caught) {
          error = caught instanceof Error ? caught.message : String(caught);
        }
      }
      const lang = address?.searchParams.get('lang') ?? '';
      const kind = address?.searchParams.get('kind') ?? '';
      const languageOk = official ? lang.startsWith('zh') && kind !== 'asr' : lang.startsWith('en');
      if (events > 0 && !languageOk) error = official ? `有官方中文却选了 ${lang}` : `选了 ${lang || '空语言'}`;
      return {
        video: location.href,
        ok: events > 0 && languageOk,
        title: details?.title ?? document.title,
        author: details?.author ?? '',
        lang,
        kind,
        events,
        officialChinese: official,
        error,
      };

      interface Track {
        baseUrl?: string;
        url?: string;
        languageCode?: string;
        kind?: string;
      }
      function playerResponse(): { videoDetails?: { title?: string; author?: string }; captions?: { playerCaptionsTracklistRenderer?: { captionTracks?: Track[] } } } | undefined {
        return (window as Window & { ytInitialPlayerResponse?: ReturnType<typeof playerResponse> }).ytInitialPlayerResponse;
      }
      function listedTracks(): Track[] {
        const listed = playerResponse()?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
        const live = (document.querySelector('#movie_player') as { getAudioTrack?: () => { captionTracks?: Track[] } } | null)?.getAudioTrack?.()?.captionTracks ?? [];
        return [...live, ...listed];
      }
      function officialChinese(track: Track): boolean {
        return !!track.languageCode?.startsWith('zh') && track.kind !== 'asr' && !addressOf(track).includes('tlang=');
      }
      function addressOf(track: Track): string {
        return track.url || track.baseUrl || '';
      }
    });
  } catch (caught) {
    return blank(caught instanceof Error ? caught.message : String(caught));
  }
}
