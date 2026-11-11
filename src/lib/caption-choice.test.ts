import { describe, expect, it } from 'vitest';
import { chooseCaption, type ListedCaption } from './caption-choice';

const manual = (lang: string, pot = false): ListedCaption => ({
  languageCode: lang,
  url: `https://www.youtube.com/api/timedtext?v=talk&lang=${lang}${pot ? '&pot=1' : ''}`,
});

const asr = (lang: string, pot = false): ListedCaption => ({
  languageCode: lang,
  kind: 'asr',
  url: `https://www.youtube.com/api/timedtext?v=talk&lang=${lang}&kind=asr${pot ? '&pot=1' : ''}`,
});

describe('chooseCaption', () => {
  it('uses creator-uploaded simplified Chinese ahead of English', () => {
    const chosen = chooseCaption([manual('en', true), asr('en', true), manual('zh-Hans', true), manual('zh-Hant', true)]);
    expect(chosen?.lang).toBe('zh-Hans');
    expect(chosen?.native).toBe(true);
    expect(chosen?.url).toContain('c=WEB');
    expect(chosen?.settled).toBe(true);
  });

  it('uses traditional Chinese when that is the only uploaded Chinese track', () => {
    const chosen = chooseCaption([manual('en', true), manual('zh-TW', true)]);
    expect(chosen?.lang).toBe('zh-TW');
    expect(chosen?.native).toBe(true);
  });

  it('uses uploaded English when Chinese exists only as an automatic track', () => {
    const chosen = chooseCaption([asr('zh-Hans', true), manual('en', true), asr('en', true)]);
    expect(chosen?.lang).toBe('en');
    expect(chosen?.written).toBe(true);
    expect(chosen?.native).toBe(false);
  });

  it('uses automatic English when no uploaded English or Chinese track exists', () => {
    const chosen = chooseCaption([asr('en', true), asr('de', true), manual('fr', true)]);
    expect(chosen?.lang).toBe('en');
    expect(chosen?.written).toBe(false);
    expect(chosen?.url).toContain('kind=asr');
  });

  it('ignores a listed address once any track carries a token', () => {
    const chosen = chooseCaption([manual('zh-Hans'), manual('en', true)]);
    expect(chosen?.lang).toBe('en');
    expect(chosen?.pot).toBe(true);
    expect(chosen?.settled).toBe(false);
  });

  it('drops machine translations and addresses that are not caption tracks', () => {
    const chosen = chooseCaption([
      { languageCode: 'zh-Hans', url: 'https://www.youtube.com/api/timedtext?v=talk&lang=en&tlang=zh-Hans&pot=1' },
      { languageCode: 'en', url: 'https://evil.example/api/timedtext?v=talk&lang=en&pot=1' },
      manual('en', true),
    ]);
    expect(chosen?.lang).toBe('en');
    expect(chosen?.url).toContain('www.youtube.com');
  });
});
