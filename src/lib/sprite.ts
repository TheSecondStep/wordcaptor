import { ART_STYLES, CARD, CIRCLE, RIDER } from './sprite-art';

export interface Sprite {
  /**
   * Sends someone out to do one piece of work. The first piece is done by the
   * sprite herself; while she is busy, each further piece gets a card that
   * flies out from her and fades when released.
   */
  dispatch(): Flyer;
  /** Shows a short message next to the sprite for a few seconds. */
  say(text: string): void;
  /** Shows the troubled face and the reason. The next dispatch clears it. */
  fail(text: string): void;
  /** Sets the one-character label of the mode button. */
  setMode(label: string): void;
  /** Plays the release: a magic circle opens under her. For the moment work begins. */
  release(): void;
  /** Plays a small hop. For things that went well. */
  cheer(): void;
  /** Plays the sealing of a note: a card rises from where the note was and flies to her. */
  seal(from: Element): void;
  /**
   * Offers to explain something: a small question mark at a place on screen.
   * Picking it calls back; offering null takes it away.
   */
  offer(spot: { x: number; y: number } | null, onPick?: () => void): void;
  /** Takes the sprite off the page. */
  remove(): void;
}

export interface Flyer {
  /**
   * Flies to the end of an element's text, where the writing just stopped, and
   * stays with it as the page scrolls. While the element is off screen the
   * flyer is not shown.
   */
  moveTo(target: Element): void;
  /** Ends this piece of work. */
  release(): void;
}

export interface SpriteHandlers {
  onClick(): void;
  onMode(): void;
  onClose(): void;
  /** The reader typed something to the sprite. */
  onSay(text: string): void;
  /** The reader dragged the sprite and let go at this point. True if something there was taken on. */
  onDrop(x: number, y: number): boolean;
}

const WIDTH = 56;
const HEIGHT = 51;
const EDGE = 18;
const FLY_MS = 650;
const SAY_MS = 7000;
const FADE_MS = 400;
const ARRIVAL_SPARKS = 5;
const SLEEP_AFTER_MS = 90_000;
/** A press that moves less than this is a click, not a drag. */
const DRAG_SLOP = 6;

const STYLES = `
:host {
  all: initial;
  position: fixed;
  left: 0;
  top: 0;
  width: 0;
  height: 0;
  z-index: 2147483647;
  pointer-events: none;
}
.light {
  position: absolute;
  left: 0;
  top: 0;
  /* Eases in to the target without overshooting it: on a long flight an overshoot lands on other content. */
  transition: transform ${FLY_MS}ms cubic-bezier(0.22, 1, 0.36, 1), opacity ${FADE_MS}ms ease;
  font: 13px/1.5 system-ui, sans-serif;
}
.main { width: ${WIDTH}px; height: ${HEIGHT}px; pointer-events: auto; }
.main.dragging { transition: none; }
.mote { width: 14px; height: 23px; margin: 14px 0 0 6px; filter: drop-shadow(0 0 4px rgba(255, 200, 110, 0.9)); }
.mote svg { animation: tumble 1.4s ease-in-out infinite alternate; }
.mote.away, .mote.leaving { opacity: 0; }

.body {
  all: unset;
  display: block;
  width: 100%;
  height: 100%;
  cursor: grab;
  touch-action: none;
  animation: drift 4.6s ease-in-out infinite;
}
.dragging .body { cursor: grabbing; }
.body:focus-visible { outline: 2px solid #ff8fb4; outline-offset: 3px; border-radius: 12px; }
${ART_STYLES}

.chip {
  all: unset;
  position: absolute;
  width: 17px;
  height: 17px;
  border-radius: 50%;
  background: #fff;
  color: #b0527a;
  font: 600 10px/17px system-ui, sans-serif;
  text-align: center;
  cursor: pointer;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
  opacity: 0;
  transition: opacity 0.15s;
}
.mode { top: -8px; left: -8px; }
.talk { top: -8px; left: 13px; }
.close { top: -8px; right: -8px; color: #777; }
.main:hover .chip, .main:focus-within .chip { opacity: 1; }

.bubble, .ask {
  position: absolute;
  bottom: ${HEIGHT + 12}px;
  box-sizing: border-box;
  width: max-content;
  max-width: 260px;
  padding: 7px 11px;
  border-radius: 12px;
  background: #fffafc;
  color: #4a3f45;
  box-shadow: 0 2px 10px rgba(120, 40, 80, 0.2);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.bubble:empty, .ask[hidden] { display: none; }
.main[data-side="right"] :is(.bubble, .ask) { right: 0; }
.main[data-side="left"] :is(.bubble, .ask) { left: 0; }
.ask { width: 240px; padding: 5px; }
.ask input {
  all: unset;
  box-sizing: border-box;
  width: 100%;
  padding: 3px 7px;
  font: inherit;
  color: inherit;
}
.ask input::placeholder { color: #b9a4ae; }

.zzz {
  position: absolute;
  top: -6px;
  right: 2px;
  color: #a9b6e8;
  font: 700 11px system-ui, sans-serif;
  opacity: 0;
}
[data-state="asleep"] .zzz { animation: zzz 3s ease-in-out infinite; }

.question {
  all: unset;
  position: absolute;
  width: 22px;
  height: 22px;
  margin: 4px 0 0 4px;
  border-radius: 50% 50% 50% 4px;
  background: #ffd23f;
  color: #6b4a00;
  font: 700 13px/22px system-ui, sans-serif;
  text-align: center;
  cursor: pointer;
  pointer-events: auto;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.25);
  animation: pop 0.18s ease-out;
}

.spark {
  position: absolute;
  width: 9px;
  height: 9px;
  margin: -4.5px;
  background: #ffe27a;
  clip-path: polygon(50% 0, 62% 38%, 100% 50%, 62% 62%, 50% 100%, 38% 62%, 0 50%, 38% 38%);
  opacity: 0;
  /* Starts when the flyer that scatters it arrives. */
  animation: spark 0.8s ${FLY_MS * 0.7}ms ease-out forwards;
}
.circle {
  position: absolute;
  width: 130px;
  height: 130px;
  margin: -42px 0 0 -37px;
  filter: drop-shadow(0 0 6px rgba(255, 205, 90, 0.9));
  animation: circle 1.3s ease-out forwards;
}
.sealed {
  position: absolute;
  width: 16px;
  height: 26px;
  margin: -13px 0 0 -8px;
  filter: drop-shadow(0 0 5px rgba(255, 200, 110, 0.95));
  transition: transform 0.7s cubic-bezier(0.5, 0, 0.3, 1) 0.25s, opacity 0.3s ease 0.75s;
  animation: pop 0.25s ease-out;
}

@keyframes drift { 50% { transform: translateY(-4px) rotate(-2deg); } }
@keyframes tumble { from { transform: rotate(-16deg); } to { transform: rotate(16deg) scale(0.92); } }
@keyframes spark {
  from { opacity: 1; }
  to { transform: translate(var(--dx), var(--dy)) scale(0) rotate(120deg); opacity: 0; }
}
@keyframes circle {
  from { transform: scale(0.15) rotate(-90deg); opacity: 0; }
  35% { opacity: 1; }
  70% { transform: scale(1) rotate(40deg); opacity: 0.9; }
  to { transform: scale(1.08) rotate(70deg); opacity: 0; }
}
@keyframes pop { from { transform: scale(0.3); opacity: 0; } }
@keyframes zzz {
  from { transform: translate(0, 4px) scale(0.7); opacity: 0; }
  40% { opacity: 1; }
  to { transform: translate(7px, -12px) scale(1.1); opacity: 0; }
}
@media (prefers-reduced-motion: reduce) {
  .light, .sealed { transition: none; }
  .body, .body *, .mote svg, .zzz, .question, .circle { animation: none !important; }
  .circle { display: none; }
}
`;

interface Light {
  el: HTMLElement;
  x: number;
  y: number;
  target: Element | null;
}

/**
 * Creates the sprite: a small rider who rests in the page corner, flies to
 * wherever a translation is being written, and is the one thing the reader
 * clicks, drags, and talks to. She lives in a shadow root so the page's styles
 * and ours cannot affect each other.
 */
export function createSprite(handlers: SpriteHandlers): Sprite {
  const host = document.createElement('div');
  host.id = 'wisp-sprite';
  const shadow = host.attachShadow({ mode: 'open' });
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(STYLES);
  shadow.adoptedStyleSheets = [sheet];

  const root = el('div', 'root');
  root.dataset.state = 'idle';

  const body = el('button', 'body');
  body.setAttribute('aria-label', '百变小译：开始或暂停');
  body.title = '点我：开始或暂停　拖我到一段话上：只处理那一段';
  body.innerHTML = RIDER;

  const modeButton = chip('mode', '切换翻译模式和学习模式', handlers.onMode);
  const talkButton = chip('talk', '跟我说：想要什么样的译文、你的水平、这个网站别来……', () => {
    ask.hidden = !ask.hidden;
    if (!ask.hidden) {
      bubble.textContent = '';
      input.focus();
    }
  });
  talkButton.textContent = '…';
  const close = chip('close', '在这个网站不要出现', () => {
    remove();
    handlers.onClose();
  });
  close.textContent = '×';

  const bubble = el('div', 'bubble');
  bubble.setAttribute('role', 'status');

  const ask = el('form', 'ask') as HTMLFormElement;
  ask.hidden = true;
  const input = document.createElement('input');
  input.placeholder = '跟我说点什么，比如「译文口语一点」';
  input.setAttribute('aria-label', '跟小樱说话');
  ask.append(input);
  ask.addEventListener('submit', (event) => {
    event.preventDefault();
    const said = input.value.trim();
    if (!said) return;
    input.value = '';
    ask.hidden = true;
    say('嗯……');
    handlers.onSay(said);
  });
  // Typing here must not trigger the page's own keyboard shortcuts.
  for (const type of ['keydown', 'keyup', 'keypress']) {
    input.addEventListener(type, (event) => {
      event.stopPropagation();
      if (type === 'keydown' && (event as KeyboardEvent).key === 'Escape') ask.hidden = true;
    });
  }

  const zzz = el('span', 'zzz');
  zzz.textContent = 'z';

  const main: Light = { el: el('div', 'light main'), x: 0, y: 0, target: null };
  main.el.append(body, modeButton, talkButton, close, zzz, bubble, ask);
  root.append(main.el);
  shadow.append(root);
  document.documentElement.append(host);

  const lights = new Set<Light>([main]);
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  /** Where she rests, as the distance of her right and bottom edges from those of the window. */
  const home = { right: EDGE, bottom: EDGE };
  let mainBusy = false;
  let working = 0;
  let sayTimer: ReturnType<typeof setTimeout> | undefined;
  let sleepTimer: ReturnType<typeof setTimeout> | undefined;
  let question: HTMLElement | null = null;

  function place(light: Light, x: number, y: number) {
    light.x = Math.round(x);
    light.y = Math.round(y);
    light.el.style.transform = `translate(${light.x}px, ${light.y}px)`;
    if (light === main) main.el.dataset.side = x > innerWidth / 2 ? 'right' : 'left';
  }

  /**
   * Puts a flyer at the end of its target's text and reports whether it is
   * there. With no target on screen, the sprite rests at home and a card is
   * not shown.
   */
  function settle(light: Light): boolean {
    const spot = light.target?.isConnected ? spotAfter(light.target) : null;
    if (spot) {
      light.el.classList.remove('away');
      place(light, spot.x, spot.y);
      return true;
    }
    if (light === main) {
      place(
        main,
        clamp(innerWidth - WIDTH - home.right, 2, innerWidth - WIDTH - 2),
        clamp(innerHeight - HEIGHT - home.bottom, 2, innerHeight - HEIGHT - 2),
      );
    } else {
      light.el.classList.add('away');
    }
    return false;
  }

  function follow() {
    lights.forEach(settle);
  }

  /** Scatters a few fading stars where a flyer is about to arrive. */
  function sparkle(light: Light) {
    if (reducedMotion.matches) return;
    for (let i = 0; i < ARRIVAL_SPARKS; i++) {
      const spark = el('span', 'spark');
      spark.style.left = `${light.x + 8 + jitter(10)}px`;
      spark.style.top = `${light.y + HEIGHT * 0.8 + jitter(10)}px`;
      spark.style.setProperty('--dx', `${jitter(30)}px`);
      spark.style.setProperty('--dy', `${6 + jitter(22)}px`);
      spark.addEventListener('animationend', () => spark.remove());
      root.append(spark);
    }
  }

  /** A card that waits, unseen, where the sprite is until it has somewhere to go. */
  function spawnMote(): Light {
    const mote: Light = { el: el('div', 'light mote away'), x: 0, y: 0, target: null };
    mote.el.innerHTML = CARD;
    place(mote, main.x, main.y);
    root.append(mote.el);
    mote.el.getBoundingClientRect(); // commit the starting point so the first move animates from it
    lights.add(mote);
    return mote;
  }

  /** Plays a one-off move on the rider by setting a class for as long as its animation runs. */
  function act(move: 'releasing' | 'cheering' | 'sealing', ms: number) {
    body.classList.add(move);
    setTimeout(() => body.classList.remove(move), ms);
  }

  /** Any sign of life keeps her awake; left alone and idle, she dozes off. */
  function stir() {
    if (root.dataset.state === 'asleep') root.dataset.state = 'idle';
    clearTimeout(sleepTimer);
    sleepTimer = setTimeout(() => {
      if (root.dataset.state === 'idle') root.dataset.state = 'asleep';
    }, SLEEP_AFTER_MS);
  }

  function say(text: string) {
    stir();
    bubble.textContent = text;
    clearTimeout(sayTimer);
    sayTimer = setTimeout(() => (bubble.textContent = ''), SAY_MS);
  }

  function remove() {
    removeEventListener('resize', follow);
    removeEventListener('scroll', follow, true);
    clearTimeout(sleepTimer);
    host.remove();
  }

  // A press that moves is a drag; one that does not is a click.
  let press: { x: number; y: number; dragging: boolean } | null = null;
  /** Set when a drag ends, for the click the browser fires right after it. */
  let justDragged = false;
  body.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    justDragged = false;
    press = { x: event.clientX, y: event.clientY, dragging: false };
    body.setPointerCapture(event.pointerId);
  });
  body.addEventListener('pointermove', (event) => {
    if (!press) return;
    if (!press.dragging && Math.hypot(event.clientX - press.x, event.clientY - press.y) < DRAG_SLOP) return;
    press.dragging = true;
    main.el.classList.add('dragging');
    place(main, event.clientX - WIDTH / 2, event.clientY - HEIGHT / 2);
  });
  body.addEventListener('pointerup', (event) => {
    const dragged = press?.dragging;
    press = null;
    if (!dragged) return;
    justDragged = true;
    main.el.classList.remove('dragging');
    // Dropped on something to read, she takes it on and goes back to where she
    // rests. Dropped anywhere else, that becomes where she rests.
    if (!handlers.onDrop(event.clientX, event.clientY)) {
      home.right = innerWidth - main.x - WIDTH;
      home.bottom = innerHeight - main.y - HEIGHT;
    }
    settle(main);
  });
  body.addEventListener('click', () => {
    stir();
    // The click that ends a drag is not a click on her.
    if (justDragged) justDragged = false;
    else handlers.onClick();
  });

  main.el.addEventListener('pointerenter', stir);
  addEventListener('resize', follow);
  addEventListener('scroll', follow, { capture: true, passive: true });
  settle(main);
  stir();

  return {
    say,
    remove,
    setMode(label) {
      modeButton.textContent = label;
    },
    fail(text) {
      root.dataset.state = 'error';
      say(text);
    },
    release() {
      stir();
      act('releasing', 900);
      if (reducedMotion.matches) return;
      const circle = el('div', 'circle');
      circle.innerHTML = CIRCLE;
      circle.style.left = `${main.x}px`;
      circle.style.top = `${main.y}px`;
      circle.addEventListener('animationend', () => circle.remove());
      root.prepend(circle);
    },
    cheer() {
      stir();
      act('cheering', 600);
    },
    seal(from) {
      stir();
      act('sealing', 450);
      if (reducedMotion.matches) return;
      const rect = from.getBoundingClientRect();
      const card = el('div', 'sealed');
      card.innerHTML = CARD;
      card.style.left = `${rect.left + rect.width / 2}px`;
      card.style.top = `${rect.top}px`;
      root.append(card);
      card.getBoundingClientRect(); // commit the starting point so the flight animates from it
      const dx = main.x + WIDTH / 2 - (rect.left + rect.width / 2);
      const dy = main.y + HEIGHT / 2 - rect.top;
      card.style.transform = `translate(${dx}px, ${dy}px) scale(0.4) rotate(200deg)`;
      card.style.opacity = '0';
      setTimeout(() => card.remove(), 1100);
    },
    offer(spot, onPick) {
      question?.remove();
      question = null;
      if (!spot || !onPick) return;
      const button = el('button', 'question');
      button.textContent = '？';
      button.title = '这里是什么意思？';
      button.setAttribute('aria-label', '解释选中的内容');
      button.style.left = `${clamp(spot.x, 2, innerWidth - 30)}px`;
      button.style.top = `${clamp(spot.y, 2, innerHeight - 30)}px`;
      // Pressing it must not clear the selection it is about.
      button.addEventListener('pointerdown', (event) => event.preventDefault());
      button.addEventListener('click', () => {
        button.remove();
        question = null;
        onPick();
      });
      question = button;
      root.append(button);
    },
    dispatch() {
      const light = mainBusy ? spawnMote() : main;
      if (light === main) mainBusy = true;
      working++;
      clearTimeout(sleepTimer);
      root.dataset.state = 'working';

      return {
        moveTo(target) {
          light.target = target;
          if (settle(light)) sparkle(light);
        },
        release() {
          light.target = null;
          if (light === main) {
            mainBusy = false;
            settle(main);
          } else {
            // Fades out where it is, beside what it wrote.
            lights.delete(light);
            light.el.classList.add('leaving');
            setTimeout(() => light.el.remove(), FADE_MS);
          }
          if (--working === 0 && root.dataset.state === 'working') {
            root.dataset.state = 'idle';
            stir();
          }
        },
      };
    },
  };

  function chip(className: string, label: string, onClick: () => void): HTMLElement {
    const button = el('button', `chip ${className}`);
    button.setAttribute('aria-label', label);
    button.title = label;
    button.addEventListener('click', onClick);
    return button;
  }
}

/**
 * Where a flyer hovers for an element: just past the end of its last line of
 * text, like a pen that has stopped writing. Null when that spot is off screen.
 */
function spotAfter(target: Element): { x: number; y: number } | null {
  const range = document.createRange();
  range.selectNodeContents(target);
  const lines = range.getClientRects();
  const last = lines[lines.length - 1] ?? target.getBoundingClientRect();
  if (last.bottom <= 0 || last.top >= innerHeight) return null;
  return {
    x: clamp(last.right + 2, 2, innerWidth - WIDTH - 2),
    // The wand's star, low on her left, is what points at the line.
    y: clamp(last.top + last.height / 2 - HEIGHT * 0.8, 2, innerHeight - HEIGHT - 2),
  };
}

function el(tag: string, className: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function jitter(range: number): number {
  return (Math.random() - 0.5) * range;
}
