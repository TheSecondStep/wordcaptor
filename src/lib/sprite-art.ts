/**
 * How the sprite looks: a small girl riding a winged star wand, drawn in the
 * spirit of Cardcaptor Sakura. Everything that is a likeness lives in this
 * file, so the sprite can be given another look by replacing it.
 *
 * Class names in the drawings are hooks for the animations in sprite.ts.
 */

const STAR = '8,41.9 8.94,44.41 11.61,44.53 9.52,46.19 10.23,48.77 8,47.3 5.77,48.77 6.48,46.19 4.39,44.53 7.06,44.41';
const WING = 'M40 42 C42 30 50 20 60 15 C60.5 21 58.5 25.5 55.5 28 C58.5 28 60.5 30 60.5 32 C57.5 33.5 54.5 34.3 51.5 34.3 C54.5 36 55.5 38 54.5 40 C49.5 41.4 44.5 42.2 40 42 Z';

/** The rider, facing left, toward the text she writes beside. */
export const RIDER = `
<svg viewBox="0 0 64 58" aria-hidden="true">
  <g class="wing far"><path d="${WING}" transform="translate(-4 -1.5) scale(0.9)" /></g>
  <g class="wand">
    <path d="M9 45.6 L60 41" stroke="#d9779b" stroke-width="3.2" stroke-linecap="round" />
    <path d="M9 45.6 L60 41" stroke="#ffc6d9" stroke-width="1.8" stroke-linecap="round" />
    <path class="feather" d="M12.5 43.5 C13 40.5 15.5 39 18 39 C17.5 41.5 15.5 43.3 12.5 43.5 Z" />
    <path class="feather" d="M12.8 47.6 C14 50 16.5 51 19 50.4 C18 48.4 15.8 47.2 12.8 47.6 Z" />
    <circle cx="8" cy="45.7" r="5.4" fill="#fff7cf" stroke="#f0b93a" stroke-width="1.5" />
    <polygon class="star" points="${STAR}" fill="#ffd23f" stroke="#e8a317" stroke-width="0.4" stroke-linejoin="round" />
  </g>
  <g class="wing near"><path d="${WING}" /></g>
  <g class="rider">
    <path d="M35.6 35 Q37.4 39 35.4 42.8" stroke="#ffe3cf" stroke-width="2.2" stroke-linecap="round" fill="none" />
    <path d="M27 45.2 L26 52" stroke="#ffe3cf" stroke-width="2.4" stroke-linecap="round" />
    <path d="M32.6 45.4 L33.2 52" stroke="#ffe3cf" stroke-width="2.4" stroke-linecap="round" />
    <path d="M26.2 50.4 L26 52 M33 50.4 L33.2 52" stroke="#fff" stroke-width="2.6" stroke-linecap="round" />
    <ellipse cx="25.2" cy="53.4" rx="2.4" ry="1.5" fill="#ff8fb1" />
    <ellipse cx="33.4" cy="53.4" rx="2.4" ry="1.5" fill="#ff8fb1" />
    <path d="M24 33 Q30 30 36 33 L40.5 44 Q30.5 47.5 20.5 44 Z" fill="#ffb3c7" stroke="#e0819f" stroke-width="0.6" stroke-linejoin="round" />
    <path d="M20.5 44 Q30.5 47.5 40.5 44" stroke="#fff" stroke-width="1.5" stroke-linecap="round" fill="none" />
    <circle cx="24.4" cy="34.6" r="2.5" fill="#fff" stroke="#f1c7d3" stroke-width="0.4" />
    <circle cx="35.6" cy="34.6" r="2.5" fill="#fff" stroke="#f1c7d3" stroke-width="0.4" />
    <path d="M24 36.2 Q20.4 39 19.6 44.2" stroke="#ffe3cf" stroke-width="2.2" stroke-linecap="round" fill="none" />
    <path d="M30 35 L26.6 33.2 L26.8 37 Z M30 35 L33.4 33.2 L33.2 37 Z" fill="#f2495f" stroke="#c9304a" stroke-width="0.3" stroke-linejoin="round" />
    <circle cx="30" cy="35" r="1" fill="#f2495f" stroke="#c9304a" stroke-width="0.3" />
    <g class="head">
      <path class="hair" d="M18 22 C16 10 24 6.5 30 6.5 C37 6.5 44 10 42 23 C42.5 27 41 30.4 39.5 31.6 L20.5 31.6 C19 30.4 17.5 27 18 22 Z" />
      <path class="hair tuft" d="M19.6 13.4 C15 9.6 11.6 10.8 10.6 14 C13.8 13.4 16.6 15 18.4 17.4 Z" />
      <path class="hair tuft" d="M40.4 13.4 C45 9.6 48.4 10.8 49.4 14 C46.2 13.4 43.4 15 41.6 17.4 Z" />
      <ellipse cx="30" cy="22.6" rx="10.3" ry="9.8" fill="#ffecdf" stroke="#e9b99c" stroke-width="0.4" />
      <path class="hair" d="M19.5 20 C18.8 12 24 8 30 8 C36 8 41.2 12 40.5 20 C38.8 17.8 37.2 16.4 35.6 15.6 C35.4 17.2 34.6 18.2 33.6 18.8 C33.1 17.2 32.1 16 30.7 15.2 C29.9 17 28.2 18.4 26 19 C26.3 17.8 26.1 16.6 25.6 15.8 C23.6 16.8 21.4 18.2 19.5 20 Z" />
      <path d="M30 8 C29 5 31 3.4 33.2 4.6" stroke="#b9733c" stroke-width="1" stroke-linecap="round" fill="none" />
      <circle cx="19" cy="14.8" r="1.5" fill="#ff7096" />
      <circle cx="41" cy="14.8" r="1.5" fill="#ff7096" />
      <g class="eyes open">
        <ellipse cx="25.4" cy="24" rx="2.1" ry="2.9" fill="#35a86b" />
        <ellipse cx="34.2" cy="24" rx="2.1" ry="2.9" fill="#35a86b" />
        <ellipse cx="25.4" cy="24.4" rx="1.1" ry="1.8" fill="#14653a" />
        <ellipse cx="34.2" cy="24.4" rx="1.1" ry="1.8" fill="#14653a" />
        <path d="M23.2 22.9 Q25.4 20.4 27.6 22.9 M32 22.9 Q34.2 20.4 36.4 22.9" stroke="#6b4423" stroke-width="0.9" stroke-linecap="round" fill="none" />
        <circle cx="24.7" cy="22.8" r="0.8" fill="#fff" />
        <circle cx="33.5" cy="22.8" r="0.8" fill="#fff" />
      </g>
      <path class="eyes shut" d="M23.3 24 Q25.4 25.8 27.5 24 M32.1 24 Q34.2 25.8 36.3 24" stroke="#6b4423" stroke-width="0.9" stroke-linecap="round" fill="none" />
      <path class="eyes dizzy" d="M23.4 22.4 L27.2 24 L23.4 25.6 M36.2 22.4 L32.4 24 L36.2 25.6" stroke="#6b4423" stroke-width="0.9" stroke-linecap="round" stroke-linejoin="round" fill="none" />
      <ellipse cx="22.4" cy="27.6" rx="2" ry="1.1" fill="#ff9eb0" opacity="0.65" />
      <ellipse cx="37.2" cy="27.6" rx="2" ry="1.1" fill="#ff9eb0" opacity="0.65" />
      <path class="mouth smile" d="M28.6 28.4 Q29.8 29.7 31 28.4" stroke="#c0604f" stroke-width="0.7" stroke-linecap="round" fill="none" />
      <path class="mouth open" d="M28.4 28.2 Q29.8 31.2 31.2 28.2 Z" fill="#e8647a" stroke="#c0604f" stroke-width="0.4" stroke-linejoin="round" />
      <path class="mouth wavy" d="M28 29 Q28.9 28 29.8 29 T31.6 29" stroke="#c0604f" stroke-width="0.7" stroke-linecap="round" fill="none" />
      <path class="sweat" d="M43.4 13 C45 15.6 45.4 16.8 43.4 17.8 C41.4 16.8 41.8 15.6 43.4 13 Z" fill="#a8d8ff" stroke="#6fb4ea" stroke-width="0.3" />
    </g>
  </g>
</svg>`;

/** A card: what goes out to work on a batch of its own, and what a sealed note turns into. */
export const CARD = `
<svg viewBox="0 0 16 26" aria-hidden="true">
  <rect x="0.8" y="0.8" width="14.4" height="24.4" rx="2" fill="#ff8fb4" stroke="#f0b93a" stroke-width="1.2" />
  <rect x="3" y="3" width="10" height="20" rx="1" fill="none" stroke="#ffe7a3" stroke-width="0.6" />
  <circle cx="8" cy="13" r="3.6" fill="#fff3c4" stroke="#f0b93a" stroke-width="0.6" />
  <path d="M8 10.2 L8.8 12.2 L11 12.3 L9.3 13.6 L9.9 15.7 L8 14.5 L6.1 15.7 L6.7 13.6 L5 12.3 L7.2 12.2 Z" fill="#ffd23f" />
</svg>`;

/** The circle that opens under her when the magic is released. */
export const CIRCLE = `
<svg viewBox="0 0 100 100" aria-hidden="true">
  <g fill="none" stroke="#f3c44f" stroke-linejoin="round">
    <circle cx="50" cy="50" r="47" stroke-width="1.6" />
    <circle cx="50" cy="50" r="41" stroke-width="0.8" />
    <path d="M50 9 L74.1 83.2 L11 37.3 L89 37.3 L25.9 83.2 Z" stroke-width="1.1" />
    <circle cx="50" cy="50" r="11" stroke-width="1" />
  </g>
  <circle cx="20" cy="50" r="4.6" fill="#ffd86b" />
  <path d="M83 44.5 A6 6 0 1 0 83 55.5 A4.6 4.6 0 1 1 83 44.5 Z" fill="#ffd86b" />
  <path d="M50 43 L52 48 L57.5 48.3 L53.2 51.6 L54.7 57 L50 54 L45.3 57 L46.8 51.6 L42.5 48.3 L48 48 Z" fill="#ffd86b" />
</svg>`;

/** How the drawings are colored and how they move. `--w` is the width the rider is shown at. */
export const ART_STYLES = `
svg { display: block; width: 100%; height: 100%; overflow: visible; }
.body svg { filter: drop-shadow(0 1px 2px rgba(190, 90, 120, 0.35)) drop-shadow(0 0 5px rgba(255, 214, 120, 0.55)); }
.hair { fill: #c98b52; stroke: #a56a36; stroke-width: 0.4; stroke-linejoin: round; }
.wing path, .feather { fill: #fff; stroke: #b4c0e4; stroke-width: 0.5; stroke-linejoin: round; }
.wing.far { opacity: 0.8; }
.wing { transform-origin: 40px 42px; animation: flap 0.9s ease-in-out infinite alternate; }
.wing.far { animation-delay: -0.15s; }
.rider { transform-origin: 30px 44px; animation: sway 3.2s ease-in-out infinite; }
.tuft { transform-origin: 30px 16px; animation: sway 2.1s ease-in-out infinite reverse; }
.eyes.open { transform-origin: 30px 24px; animation: blink 4.6s infinite; }
.star { transform-origin: 8px 45.7px; animation: twinkle 2.4s ease-in-out infinite; }
.eyes.shut, .eyes.dizzy, .mouth.open, .mouth.wavy, .sweat { display: none; }

/* Flying to where the writing is: leaning into it, wings beating fast. */
[data-state="working"] .body { animation: lean 0.5s ease-in-out infinite alternate; }
[data-state="working"] .wing { animation-duration: 0.16s; }
[data-state="working"] .mouth.smile { display: none; }
[data-state="working"] .mouth.open { display: block; }

/* Something went wrong: the "hoe…" face. */
[data-state="error"] .body { animation: none; rotate: 8deg; }
[data-state="error"] .body svg { filter: saturate(0.45); }
[data-state="error"] .eyes.open, [data-state="error"] .mouth.smile { display: none; }
[data-state="error"] .eyes.dizzy, [data-state="error"] .mouth.wavy, [data-state="error"] .sweat { display: block; }
[data-state="error"] .wing { animation-duration: 2.4s; }

/* Left alone for a while, she dozes off on the wand. */
[data-state="asleep"] .eyes.open { display: none; }
[data-state="asleep"] .eyes.shut { display: block; }
[data-state="asleep"] .head { transform-origin: 30px 32px; animation: nod 3s ease-in-out infinite; }
[data-state="asleep"] .wing { animation-duration: 2.6s; }

/* Release: the wand's star flares and she rises. Cheer: a little hop with the wand raised. */
.body.releasing { animation: rise 0.9s ease-out; }
.body.releasing .star, .body.cheering .star { animation: flare 0.45s ease-in-out 2; }
.body.cheering { animation: hop 0.6s ease-out; }
.body.cheering .mouth.smile, .body.releasing .mouth.smile { display: none; }
.body.cheering .mouth.open, .body.releasing .mouth.open { display: block; }
/* Sealing: the wand swings down on the note that is being put away. */
.body.sealing .wand { transform-origin: 45px 42px; animation: swing 0.45s ease-in-out; }

@keyframes flap { from { transform: rotate(6deg) scaleY(1); } to { transform: rotate(-14deg) scaleY(0.82); } }
@keyframes sway { 50% { transform: rotate(-2.5deg); } }
@keyframes blink { 0%, 94%, 100% { transform: scaleY(1); } 97% { transform: scaleY(0.1); } }
@keyframes twinkle { 50% { transform: scale(1.18) rotate(18deg); } }
@keyframes lean { from { transform: rotate(-6deg) translateY(0); } to { transform: rotate(-9deg) translateY(-1.5px); } }
@keyframes nod { 50% { transform: rotate(7deg); } }
@keyframes rise { 30% { transform: translateY(-9px) scale(1.08); } 60% { transform: translateY(-3px); } }
@keyframes flare { 50% { transform: scale(1.9) rotate(72deg); filter: brightness(1.5); } }
@keyframes hop { 35% { transform: translateY(-11px) rotate(-10deg); } 70% { transform: translateY(1px) rotate(3deg); } }
@keyframes swing { 40% { transform: rotate(-24deg); } 70% { transform: rotate(9deg); } }
`;
