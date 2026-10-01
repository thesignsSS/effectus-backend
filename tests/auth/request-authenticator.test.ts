import type { IncomingMessage } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import type { AuthContextResolver } from '../../src/app/modules/auth/auth-context.js';
import { Hs256TokenVerifier } from '../../src/app/modules/auth/jwt-verifier.js';
import { RequestAuthenticator } from '../../src/app/modules/auth/request-authenticator.js';
import { NOW, SECRET, context, userToken } from './helpers.js';

const LEGACY_KEY = 'chave-antiga-que-estava-no-bundle';

function build(acceptLegacyApiKey: boolean) {
  const resolver: AuthContextResolver = {
    resolve: vi.fn(async (token) => context({ userId: token.userId, email: token.email })),
  };

  return {
    resolver,
    authenticator: new RequestAuthenticator(
      { legacyApiKey: LEGACY_KEY, acceptLegacyApiKey },
      new Hs256TokenVerifier(SECRET, () => NOW),
      resolver,
    ),
  };
}

function request(headers: Record<string, string>): IncomingMessage {
  return { headers } as unknown as IncomingMessage;
}

describe('RequestAuthenticator', () => {
  it('sem credencial → não autenticado', async () => {
    const { authenticator } = build(true);

    await expect(authenticator.authenticate(request({}))).resolves.toEqual({ kind: 'unauthenticated' });
  });

  it('JWT válido → usuário do token, e o contexto fica disponível para a requisição', async () => {
    const { authenticator } = build(true);
    const req = request({ authorization: `Bearer ${userToken('user-a')}` });

    const result = await authenticator.authenticate(req);

    expect(result).toMatchObject({ kind: 'user', context: { userId: 'user-a' } });
    expect(authenticator.contextOf(req)?.userId).toBe('user-a');
  });

  it('JWT inválido → não autenticado, sem consultar o perfil', async () => {
    const { authenticator, resolver } = build(true);

    await expect(
      authenticator.authenticate(request({ authorization: 'Bearer a.b.c' })),
    ).resolves.toEqual({ kind: 'unauthenticated' });
    expect(resolver.resolve).not.toHaveBeenCalled();
  });

  it('chave antiga vale durante a transição (Bearer ou x-api-key), sem contexto de usuário', async () => {
    const { authenticator } = build(true);
    const viaBearer = request({ authorization: `Bearer ${LEGACY_KEY}` });

    await expect(authenticator.authenticate(viaBearer)).resolves.toEqual({ kind: 'legacy' });
    await expect(authenticator.authenticate(request({ 'x-api-key': LEGACY_KEY }))).resolves.toEqual({
      kind: 'legacy',
    });
    expect(authenticator.contextOf(viaBearer)).toBeUndefined();
  });

  it('chave antiga é recusada quando a transição acaba (fase 3)', async () => {
    const { authenticator } = build(false);

    await expect(
      authenticator.authenticate(request({ authorization: `Bearer ${LEGACY_KEY}` })),
    ).resolves.toEqual({ kind: 'unauthenticated' });
  });

  it('chave parecida com a antiga não passa', async () => {
    const { authenticator } = build(true);

    await expect(
      authenticator.authenticate(request({ 'x-api-key': `${LEGACY_KEY}x` })),
    ).resolves.toEqual({ kind: 'unauthenticated' });
  });
});
