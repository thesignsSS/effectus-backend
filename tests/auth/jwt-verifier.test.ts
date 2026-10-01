import { describe, expect, it } from 'vitest';
import { Hs256TokenVerifier } from '../../src/app/modules/auth/jwt-verifier.js';
import { NOW, SECRET, signJwt, userToken } from './helpers.js';

const verifier = new Hs256TokenVerifier(SECRET, () => NOW);

describe('Hs256TokenVerifier', () => {
  it('aceita token de sessão válido e devolve o usuário', async () => {
    await expect(verifier.verify(userToken('user-a'))).resolves.toEqual({
      userId: 'user-a',
      email: 'user-a@example.com',
    });
  });

  it('recusa token assinado com outro segredo', async () => {
    const forged = signJwt(
      { sub: 'user-a', role: 'authenticated', exp: NOW / 1000 + 60 },
      { secret: 'outro-segredo-qualquer-com-32-caracteres' },
    );

    await expect(verifier.verify(forged)).resolves.toBeNull();
  });

  it('recusa token expirado', async () => {
    await expect(verifier.verify(userToken('user-a', { exp: NOW / 1000 - 1 }))).resolves.toBeNull();
  });

  it('recusa token sem expiração', async () => {
    await expect(verifier.verify(userToken('user-a', { exp: undefined }))).resolves.toBeNull();
  });

  it('recusa token que ainda não vale (nbf no futuro)', async () => {
    await expect(verifier.verify(userToken('user-a', { nbf: NOW / 1000 + 60 }))).resolves.toBeNull();
  });

  it('recusa alg "none" mesmo com payload válido', async () => {
    const [, body] = userToken('user-a').split('.');
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');

    await expect(verifier.verify(`${header}.${body}.`)).resolves.toBeNull();
  });

  it('recusa token de serviço (anon/service_role), que não é um usuário', async () => {
    await expect(verifier.verify(userToken('user-a', { role: 'service_role' }))).resolves.toBeNull();
  });

  it('recusa payload adulterado mantendo a assinatura original', async () => {
    const [head, , signature] = userToken('user-a').split('.');
    const tampered = Buffer.from(
      JSON.stringify({ sub: 'user-b', role: 'authenticated', exp: NOW / 1000 + 3600 }),
    ).toString('base64url');

    await expect(verifier.verify(`${head}.${tampered}.${signature}`)).resolves.toBeNull();
  });

  it('recusa lixo sem quebrar', async () => {
    for (const garbage of ['', 'abc', 'a.b', 'a.b.c', '***.***.***']) {
      await expect(verifier.verify(garbage)).resolves.toBeNull();
    }
  });
});
