import { readdirSync } from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'wxt';

/** The handwriting font for translations: pre-split into small files, of which a page loads only the few it needs. */
const FONT_SOURCE = path.resolve('node_modules/@chinese-fonts/xiaolai/dist/Xiaolai');
const FONT_DEST = 'fonts/xiaolai';

export default defineConfig({
  srcDir: 'src',
  manifest: {
    name: 'Wisp',
    description: '一位帮你读英文网页和 YouTube 的小魔法使：只译正文，接你自己的模型。',
    // `scripting` is for putting the handwriting font's stylesheet into the pages that need it.
    permissions: ['storage', 'scripting'],
    // The model endpoint is whatever URL the user configures.
    host_permissions: ['<all_urls>'],
    action: { default_title: 'Wisp：开始或暂停' },
    commands: {
      toggle: {
        suggested_key: { default: 'Alt+W' },
        description: '开始或暂停 Wisp',
      },
    },
    // Pages load the font files themselves, so they must be reachable from any page.
    web_accessible_resources: [{ resources: [`${FONT_DEST}/*`], matches: ['<all_urls>'] }],
  },
  hooks: {
    'build:publicAssets'(_wxt, files) {
      for (const name of readdirSync(FONT_SOURCE)) {
        if (!/\.(woff2|css)$/.test(name)) continue;
        files.push({ absoluteSrc: path.join(FONT_SOURCE, name), relativeDest: `${FONT_DEST}/${name}` });
      }
      // The font's license requires that it travel with the font.
      files.push({ absoluteSrc: path.resolve('licenses/Xiaolai-OFL.txt'), relativeDest: `${FONT_DEST}/OFL.txt` });
    },
  },
});
