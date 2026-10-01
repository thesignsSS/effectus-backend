import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, expect, it } from 'vitest';
import { applyCors } from '../../src/app/modules/auth/cors.js';

function run(origin: string | undefined, allowed: string[]) {
  const headers: Record<string, string> = {};
  const response = { setHeader: (k: string, v: string) => (headers[k] = v) } as unknown as ServerResponse;

  applyCors({ headers: origin ? { origin } : {} } as IncomingMessage, response, allowed);

  return headers;
}

describe('applyCors', () => {
  it('sem lista configurada mantém * (compatível com o deploy atual)', () => {
    expect(run('https://qualquer.com', [])['Access-Control-Allow-Origin']).toBe('*');
  });

  it('com lista, devolve só a origem permitida', () => {
    const allowed = ['https://dev.effectuscb.com'];

    expect(run('https://dev.effectuscb.com', allowed)['Access-Control-Allow-Origin']).toBe(
      'https://dev.effectuscb.com',
    );
    expect(run('https://malicioso.com', allowed)['Access-Control-Allow-Origin']).toBeUndefined();
    expect(run('https://malicioso.com', allowed).Vary).toBe('Origin');
  });
});
