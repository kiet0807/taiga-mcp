import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  it('accepts the address with or without the API path and a trailing slash', () => {
    for (const url of ['https://api.taiga.io', 'https://api.taiga.io/', 'https://api.taiga.io/api/v1/']) {
      expect(loadConfig({ TAIGA_URL: url, TAIGA_TOKEN: 't' }).baseUrl).toBe('https://api.taiga.io');
    }
    expect(loadConfig({ TAIGA_URL: 'https://example.com/taiga/api/v1', TAIGA_TOKEN: 't' }).baseUrl).toBe(
      'https://example.com/taiga',
    );
  });

  it('reads a username and password, or tokens', () => {
    expect(loadConfig({ TAIGA_URL: 'https://t.example', TAIGA_USERNAME: 'u', TAIGA_PASSWORD: 'p' })).toEqual({
      baseUrl: 'https://t.example',
      credentials: { username: 'u', password: 'p' },
    });
    expect(
      loadConfig({ TAIGA_URL: 'https://t.example', TAIGA_TOKEN: 'a', TAIGA_REFRESH_TOKEN: 'r' }),
    ).toEqual({ baseUrl: 'https://t.example', token: 'a', refreshToken: 'r' });
  });

  it('treats an empty variable as unset', () => {
    expect(() => loadConfig({ TAIGA_URL: 'https://t.example', TAIGA_TOKEN: '  ' })).toThrow(ConfigError);
    expect(() => loadConfig({ TAIGA_URL: '', TAIGA_TOKEN: 't' })).toThrow(/TAIGA_URL is not set/);
  });

  it('says what is missing, without echoing secrets', () => {
    expect(() => loadConfig({ TAIGA_URL: 'not a url', TAIGA_TOKEN: 't' })).toThrow(/not a valid address/);
    expect(() => loadConfig({ TAIGA_URL: 'ftp://t.example', TAIGA_TOKEN: 't' })).toThrow(/https:\/\//);
    expect(() => loadConfig({ TAIGA_URL: 'https://t.example' })).toThrow(/No way to sign in/);
    let message = '';
    try {
      loadConfig({ TAIGA_URL: 'https://t.example', TAIGA_PASSWORD: 'hunter2' });
    } catch (error) {
      message = String(error);
    }
    expect(message).toMatch(/both TAIGA_USERNAME and TAIGA_PASSWORD/);
    expect(message).not.toContain('hunter2');
  });
});
