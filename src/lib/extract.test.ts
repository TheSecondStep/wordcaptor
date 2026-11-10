// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { blockText, findBlockAround, findHoverRegion, findReadableBlocks, findRegionBlocks } from './extract';
import { renderAnnotations, renderTranslation } from './render';

function texts(): string[] {
  return findReadableBlocks(document).map(blockText);
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('findReadableBlocks', () => {
  it('keeps article content and skips site chrome', () => {
    document.body.innerHTML = `
      <header><h1>Site name</h1><p>The site tagline goes here</p></header>
      <nav><ul><li>Home page</li><li>About us</li></ul></nav>
      <article>
        <header><h1>How compilers work</h1></header>
        <p>A compiler turns source code into machine code.</p>
        <aside><p>Subscribe to our newsletter today</p></aside>
        <h2>Parsing</h2>
        <ul><li>Lexing splits text into tokens.</li></ul>
        <pre><code>let answer = 42;</code></pre>
        <footer><p>Written by somebody famous</p></footer>
      </article>
      <footer><p>Copyright notice and legal text</p></footer>`;

    expect(texts()).toEqual([
      'How compilers work',
      'A compiler turns source code into machine code.',
      'Parsing',
      'Lexing splits text into tokens.',
    ]);
  });

  it('falls back to the whole body when the page has no main region', () => {
    document.body.innerHTML = `
      <header><p>Site header text here</p></header>
      <div><p>First paragraph of the story.</p><p>Second paragraph of the story.</p></div>`;

    expect(texts()).toEqual(['First paragraph of the story.', 'Second paragraph of the story.']);
  });

  it('prefers the largest main region over a small article card', () => {
    document.body.innerHTML = `
      <article><p>Tiny teaser card</p></article>
      <main><p>This is the real content of the page, and it is much longer.</p></main>`;

    expect(texts()).toEqual(['This is the real content of the page, and it is much longer.']);
  });

  it('includes a title that sits in a hero section above the main region, but not the rest of the hero', () => {
    document.body.innerHTML = `
      <header><h1>Site name</h1></header>
      <section><h1>The training playbook</h1><p>A practical journey through the mess</p></section>
      <main><p>What does it take to train a model today?</p></main>`;

    expect(texts()).toEqual(['The training playbook', 'What does it take to train a model today?']);
  });

  it('takes the innermost block when blocks are nested', () => {
    document.body.innerHTML = `<main><blockquote><p>Quoted words live here.</p></blockquote></main>`;

    const blocks = findReadableBlocks(document);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.tagName).toBe('P');
  });

  it('skips text that is not English', () => {
    document.body.innerHTML = `
      <main>
        <p>这一段已经是中文了，只带一个 API 单词。</p>
        <p>2024-01-01 · 12:30</p>
        <p>An English paragraph.</p>
      </main>`;

    expect(texts()).toEqual(['An English paragraph.']);
  });

  it('skips list items that are only links, but keeps prose that contains links', () => {
    document.body.innerHTML = `
      <main>
        <ul><li><a href="/a">Related article title</a></li></ul>
        <p>Read the <a href="/docs">documentation</a> before you start building.</p>
      </main>`;

    expect(texts()).toEqual(['Read the documentation before you start building.']);
  });

  it('finds the text of posts on X', () => {
    document.body.innerHTML = `
      <main>
        <article><div data-testid="tweetText" lang="en"><span>Shipping the new release today.</span></div></article>
        <article><div data-testid="User-Name">Somebody Famous</div></article>
      </main>`;

    expect(texts()).toEqual(['Shipping the new release today.']);
  });

  it('reads only the page own text from blocks Wordcaptor has written into', () => {
    document.body.innerHTML = `<main><p>We should ship it today.</p></main>`;
    const block = document.querySelector('p')!;
    renderAnnotations(block, [{ phrase: 'ship it', gloss: '发布' }]);
    renderTranslation(block, '我们今天就该发布。');

    expect(texts()).toEqual(['We should ship it today.']);
    expect(block.querySelector('rt')).not.toBeNull(); // reading did not disturb the page
  });
});

describe('table cells', () => {
  it('are reading content when they hold text, but not link-only or layout cells', () => {
    document.body.innerHTML = `
      <main>
        <table>
          <tr><th>I want to do this</th><th>Start with</th></tr>
          <tr><td>Parse documents locally and offline</td><td><a href="/x">LiteParse</a></td></tr>
          <tr><td><div>A whole column of the page laid out in a cell</div></td><td>12.5</td></tr>
        </table>
      </main>`;

    expect(texts()).toEqual(['I want to do this', 'Start with', 'Parse documents locally and offline']);
  });
});

describe('what the pointer rests on', () => {
  it('is the innermost menu, sidebar, header, footer, table, or list around the element', () => {
    document.body.innerHTML = `
      <header id="top"><nav id="menu"><a href="/"><span id="entry">Home</span></a></nav><p id="tagline">Tagline</p></header>
      <main>
        <table id="table"><tr><td id="cell"><a href="/x">Link</a></td></tr></table>
        <ul id="list"><li id="item">Item</li></ul>
      </main>`;
    const region = (id: string) => findHoverRegion(document.getElementById(id)!)?.id;

    expect(region('entry')).toBe('menu');
    expect(region('tagline')).toBe('top');
    expect(region('cell')).toBe('table');
    expect(region('item')).toBe('list');
  });

  it('is otherwise the element itself if it holds text, and nothing if it is only a container', () => {
    document.body.innerHTML = `<main id="main"><div id="wrapper"><div id="loose">Loose text</div></div></main>`;
    const region = (id: string) => findHoverRegion(document.getElementById(id)!)?.id;

    expect(region('loose')).toBe('loose');
    expect(region('wrapper')).toBeUndefined();
    expect(region('main')).toBeUndefined();
  });

  it('takes each menu entry and each whole sentence as one piece', () => {
    document.body.innerHTML = `
      <nav>
        <div>CHAPTER ONE</div>
        <a href="/a"><span>Getting started</span></a>
        <a href="/b"><span>How <img alt=""> models work</span></a>
        <p>Read the <a href="/docs">documentation</a> first.</p>
        <button>Sign in</button>
        <code>npm install</code>
        <span>42</span>
        <span>目录</span>
      </nav>`;

    const blocks = findRegionBlocks(document.querySelector('nav')!);

    expect(blocks.map(blockText)).toEqual([
      'CHAPTER ONE',
      'Getting started',
      'How models work',
      'Read the documentation first.',
    ]);
    expect(blocks.map((block) => block.tagName)).toEqual(['DIV', 'SPAN', 'SPAN', 'P']);
  });

  it('finds the same pieces after Wordcaptor has written into them', () => {
    document.body.innerHTML = `<nav><a href="/a"><span>Getting started</span></a></nav>`;
    const nav = document.querySelector('nav')!;
    const [entry] = findRegionBlocks(nav);
    renderTranslation(entry!, '开始使用');

    expect(findRegionBlocks(nav)).toEqual([entry]);
  });

  it('treats a region whose text is not wrapped in anything as one piece', () => {
    document.body.innerHTML = `<footer>Made with care in Paris</footer>`;
    const footer = document.querySelector('footer')!;

    expect(findRegionBlocks(footer)).toEqual([footer]);
  });
});

describe('the block around an element', () => {
  it('is the paragraph it sits in, or the whole sentence where there is no paragraph', () => {
    document.body.innerHTML = `
      <p id="p">Just <a id="a">ship it</a> today.</p>
      <div id="loose">A loose line with <b id="b">bold words</b> in it.</div>`;

    expect(findBlockAround(document.querySelector('#a')!)?.id).toBe('p');
    expect(findBlockAround(document.querySelector('#b')!)?.id).toBe('loose');
    expect(findBlockAround(document.querySelector('#loose')!)?.id).toBe('loose');
  });

  it('is nothing for code, for text that is not English, and for empty containers', () => {
    document.body.innerHTML = `
      <pre><code id="code">let answer = 42;</code></pre>
      <p id="zh">这一段是中文。</p>
      <div id="empty"><img /></div>`;

    for (const id of ['code', 'zh', 'empty']) expect(findBlockAround(document.querySelector(`#${id}`)!)).toBeNull();
  });
});

describe('video players', () => {
  it('are never written under: not their captions, not their controls', () => {
    document.body.innerHTML = `
      <div class="html5-video-player">
        <div id="native">Captions of the video itself</div>
        <div class="wisp-subtitle"><span id="ours">A caption line of the talk</span><span>字幕</span></div>
      </div>`;
    const player = document.querySelector<HTMLElement>('.html5-video-player')!;

    expect(findRegionBlocks(document.body)).toEqual([]);
    expect(findRegionBlocks(player)).toEqual([]);
    for (const id of ['native', 'ours']) {
      expect(findHoverRegion(document.querySelector(`#${id}`)!)).toBeNull();
      expect(findBlockAround(document.querySelector(`#${id}`)!)).toBeNull();
    }
  });
});

describe('blockText', () => {
  it('collapses whitespace', () => {
    document.body.innerHTML = `<p>  spread
      over   lines </p>`;
    expect(blockText(document.querySelector('p')!)).toBe('spread over lines');
  });
});
