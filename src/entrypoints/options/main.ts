import { chat, listModels } from '@/lib/llm';
import { findProvider, PROVIDERS } from '@/lib/providers';
import {
  addKnown,
  LEVELS,
  loadKnown,
  loadMutedSites,
  loadReader,
  loadSettings,
  onStored,
  removeKnown,
  saveMutedSites,
  saveReader,
  saveSettings,
  type Level,
  type Protocol,
  type Settings,
} from '@/lib/settings';
import { CARD, RIDER } from '@/lib/sprite-art';

const form = document.querySelector<HTMLFormElement>('#form')!;
const status = document.querySelector<HTMLElement>('#status')!;
const cards = document.querySelector<HTMLElement>('#cards')!;
const models = document.querySelector<HTMLDataListElement>('#models')!;

type Field = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
const field = (name: string) => form.elements.namedItem(name) as Field;
const lines = (name: string) => field(name).value.split('\n').map((line) => line.trim()).filter(Boolean);

document.querySelector('#portrait')!.innerHTML = RIDER;
for (const provider of PROVIDERS) {
  const group = document.querySelector(provider.codingPlan ? '#plans' : '#apis')!;
  group.append(new Option(provider.name, provider.id));
}
for (const [level, description] of Object.entries(LEVELS)) field('level').append(new Option(description, level));

function readSettings(): Settings {
  return {
    protocol: field('protocol').value as Protocol,
    baseUrl: field('baseUrl').value.trim(),
    apiKey: field('apiKey').value.trim(),
    model: field('model').value.trim(),
  };
}

function report(text: string, kind: 'ok' | 'error' | 'busy') {
  status.textContent = text;
  status.dataset.kind = kind;
}

/** Choosing a known service fills in how to reach it, so only the key is left to type. */
function showProvider(changed: boolean) {
  const provider = PROVIDERS.find((each) => each.id === field('provider').value);
  document.querySelector<HTMLElement>('#custom')!.hidden = provider !== undefined;
  document.querySelector<HTMLElement>('#plan-note')!.hidden = !provider?.codingPlan;
  if (!provider || !changed) return;
  field('protocol').value = provider.protocol;
  field('baseUrl').value = provider.baseUrl;
  field('model').value = provider.model ?? '';
  void offerModels();
}

/** Lists the models the key can use, for services that tell. The first becomes the choice if none is made. */
async function offerModels() {
  const settings = readSettings();
  models.replaceChildren();
  if (!settings.baseUrl || !settings.apiKey) return;
  const names = await listModels(settings).catch(() => []);
  models.replaceChildren(...names.map((name) => new Option(undefined, name)));
  if (!field('model').value && names[0]) field('model').value = names[0];
}

document.querySelector('#show-key')!.addEventListener('click', (event) => {
  const button = event.currentTarget as HTMLButtonElement;
  const key = field('apiKey') as HTMLInputElement;
  const shown = key.type === 'password';
  key.type = shown ? 'text' : 'password';
  button.textContent = shown ? '隐藏' : '显示';
  button.setAttribute('aria-pressed', String(shown));
});

field('provider').addEventListener('change', () => showProvider(true));
field('apiKey').addEventListener('change', () => void offerModels());
field('baseUrl').addEventListener('change', () => void offerModels());

async function save(): Promise<Settings> {
  const settings = readSettings();
  await saveSettings(settings);
  await saveReader({ level: field('level').value as Level, preferences: lines('preferences') });
  await saveMutedSites(lines('mutedSites'));
  return settings;
}

/** The reader's side of the page also changes from other tabs: by talking to the sprite, by sealing notes. */
async function showReader() {
  const [reader, mutedSites, known] = await Promise.all([loadReader(), loadMutedSites(), loadKnown()]);
  field('level').value = reader.level;
  field('preferences').value = reader.preferences.join('\n');
  field('mutedSites').value = mutedSites.join('\n');

  const phrases = Object.keys(known).sort();
  document.querySelector('#card-count')!.textContent = String(phrases.length);
  cards.replaceChildren(
    ...phrases.map((phrase) => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'card';
      card.title = '解除封印：以后重新批注这个词';
      card.innerHTML = CARD;
      const name = document.createElement('b');
      name.textContent = phrase;
      const gloss = document.createElement('span');
      gloss.textContent = known[phrase] ?? '';
      card.append(name, gloss);
      card.addEventListener('click', () => void removeKnown(phrase));
      return card;
    }),
  );
}

void Promise.all([loadSettings(), showReader()]).then(([settings]) => {
  for (const name of Object.keys(settings) as (keyof Settings)[]) field(name).value = settings[name];
  field('provider').value = findProvider(settings.protocol, settings.baseUrl)?.id ?? '';
  showProvider(false);
  void offerModels();
  // Until now the fields were disabled, so nothing typed early gets overwritten.
  document.querySelector<HTMLFieldSetElement>('#fields')!.disabled = false;
  onStored(['reader', 'mutedSites', 'known'], () => void showReader());
});

document.querySelector<HTMLInputElement>('#add-card')!.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') return;
  event.preventDefault(); // not a submit of the whole form
  const input = event.currentTarget as HTMLInputElement;
  void addKnown(input.value);
  input.value = '';
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  await save();
  report('已保存', 'ok');
});

document.querySelector('#test')!.addEventListener('click', async () => {
  if (!form.reportValidity()) return;
  const settings = await save();
  report('已保存，正在连接模型…', 'busy');
  try {
    await chat(settings, { system: 'You are a connection test.', user: 'Reply with the single word: ok' });
    report('已保存，连接成功。绝对没问题！', 'ok');
  } catch (error) {
    report(`已保存，但连接失败：${error instanceof Error ? error.message : String(error)}`, 'error');
  }
});
