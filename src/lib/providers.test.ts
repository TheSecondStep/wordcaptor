import { describe, expect, it } from 'vitest';
import { findProvider, PROVIDERS } from './providers';

describe('the known providers', () => {
  it('have distinct ids and addresses written the way they are compared', () => {
    expect(new Set(PROVIDERS.map((provider) => provider.id)).size).toBe(PROVIDERS.length);
    for (const { baseUrl } of PROVIDERS) expect(baseUrl).toMatch(/^https?:\/\/[^ ]+[^/]$/);
  });

  it('are recognized from a saved connection, whatever its trailing slashes', () => {
    expect(findProvider('openai', ' https://api.deepseek.com/ ')?.id).toBe('deepseek');
    expect(findProvider('anthropic', 'https://api.kimi.com/coding/')?.id).toBe('kimi-coding');
  });

  it('are not recognized under the other protocol, or at an address of the reader own', () => {
    expect(findProvider('anthropic', 'https://api.deepseek.com')).toBeUndefined();
    expect(findProvider('openai', 'https://example.com/v1')).toBeUndefined();
  });
});
