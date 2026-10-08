import { describe, expect, it } from 'vitest';
import { hasSensitiveUrlQuery, isHttpUrl, isSensitiveUrlParameter } from '../../src/shared/url.js';

describe('shared URL helpers', () => {
  it.each(['access_token', 'refresh-token', 'client_secret', 'apiKey', 'password', 'card_number', 'oauth_code'])(
    'recognizes sensitive query key %s',
    (name) => expect(isSensitiveUrlParameter(name)).toBe(true),
  );

  it.each(['state', 'page', 'monkey', 'tokenizer'])(
    'does not classify ordinary query key %s as sensitive',
    (name) => expect(isSensitiveUrlParameter(name)).toBe(false),
  );

  it('detects encoded and repeated sensitive query keys without inspecting or returning values', () => {
    expect(hasSensitiveUrlQuery('https://example.test/callback?state=ok&access%5Ftoken=fixture')).toBe(true);
    expect(hasSensitiveUrlQuery('https://example.test/callback?state=ok&page=3')).toBe(false);
  });

  it.each([
    'https://example.test/callback?code=SYNTHETIC_OAUTH_CODE',
    'https://example.test/#access_token=SYNTHETIC_TOKEN&state=ok',
    'https://example.test/#/callback?token=SYNTHETIC_TOKEN',
  ])('detects conventional OAuth credentials in %s', value => {
    expect(hasSensitiveUrlQuery(value)).toBe(true);
  });

  it.each([
    'http://example.test/path',
    'https://example.test/path?access_token=runtime-only',
  ])('accepts credential-free web URL %s', (value) => {
    expect(isHttpUrl(value)).toBe(true);
  });

  it.each([
    'javascript:alert(1)',
    'file:///private/page',
    'https://user:password@example.test/path',
    '/relative/path',
  ])('rejects unsafe or relative URL %s', (value) => {
    expect(isHttpUrl(value)).toBe(false);
  });
});
