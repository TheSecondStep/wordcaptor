import type { Protocol } from './settings';

/** A model service Wordcaptor knows how to reach, so the user only has to paste a key. */
export interface Provider {
  id: string;
  name: string;
  protocol: Protocol;
  baseUrl: string;
  /**
   * Filled in only where the service documents a name that keeps working as
   * its models change. For the rest, the options page asks the service for
   * its current list.
   */
  model?: string;
  /**
   * A subscription sold for use in coding tools. The key is separate from the
   * service's pay-as-you-go key, and its terms may not cover other uses.
   */
  codingPlan?: true;
  /**
   * The service takes `thinking: { type: 'disabled' }` in a chat request. Wordcaptor sends it, because a
   * model that thinks first makes the reader wait and spends several times the tokens on a translation.
   */
  thinkingSwitch?: true;
}

/** Addresses are the ones each service documents; see docs/SPEC.md for where they were checked. */
export const PROVIDERS: Provider[] = [
  { id: 'deepseek', name: 'DeepSeek', protocol: 'openai', baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash', thinkingSwitch: true },
  {
    id: 'glm-coding',
    name: '智谱 GLM Coding Plan',
    protocol: 'openai',
    baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4',
    codingPlan: true,
    thinkingSwitch: true,
  },
  { id: 'kimi-coding', name: 'Kimi Code', protocol: 'anthropic', baseUrl: 'https://api.kimi.com/coding', codingPlan: true },
  {
    id: 'minimax-coding',
    name: 'MiniMax Token Plan',
    protocol: 'anthropic',
    baseUrl: 'https://api.minimax.cn/anthropic',
    codingPlan: true,
  },
  {
    id: 'bailian-coding',
    name: '阿里云百炼 Coding Plan',
    protocol: 'openai',
    baseUrl: 'https://coding.dashscope.aliyuncs.com/v1',
    codingPlan: true,
  },
  {
    id: 'ark-coding',
    name: '火山方舟 Coding Plan',
    protocol: 'openai',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/coding/v3',
    model: 'ark-code-latest',
    codingPlan: true,
    thinkingSwitch: true,
  },
  {
    id: 'tencent-coding',
    name: '腾讯云 Coding Plan',
    protocol: 'openai',
    baseUrl: 'https://api.lkeap.cloud.tencent.com/coding/v3',
    model: 'tc-code-latest',
    codingPlan: true,
  },
  { id: 'zhipu', name: '智谱开放平台', protocol: 'openai', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', thinkingSwitch: true },
  { id: 'moonshot', name: 'Moonshot（Kimi 开放平台）', protocol: 'openai', baseUrl: 'https://api.moonshot.cn/v1' },
  { id: 'bailian', name: '阿里云百炼', protocol: 'openai', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
  { id: 'ark', name: '火山方舟', protocol: 'openai', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', thinkingSwitch: true },
  { id: 'siliconflow', name: '硅基流动', protocol: 'openai', baseUrl: 'https://api.siliconflow.cn/v1' },
  { id: 'openrouter', name: 'OpenRouter', protocol: 'openai', baseUrl: 'https://openrouter.ai/api/v1' },
  { id: 'openai', name: 'OpenAI', protocol: 'openai', baseUrl: 'https://api.openai.com/v1' },
  { id: 'anthropic', name: 'Anthropic', protocol: 'anthropic', baseUrl: 'https://api.anthropic.com' },
  {
    id: 'gemini',
    name: 'Google Gemini',
    protocol: 'openai',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
  },
  { id: 'ollama', name: 'Ollama（本机）', protocol: 'openai', baseUrl: 'http://localhost:11434/v1' },
];

/** The provider a saved connection belongs to, if it is one of the known ones. */
export function findProvider(protocol: Protocol, baseUrl: string): Provider | undefined {
  const address = baseUrl.trim().replace(/\/+$/, '');
  return PROVIDERS.find((provider) => provider.protocol === protocol && provider.baseUrl === address);
}
