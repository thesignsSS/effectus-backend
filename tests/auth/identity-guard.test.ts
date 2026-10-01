import { describe, expect, it } from 'vitest';
import { IdentityGuard, routeLabel } from '../../src/app/modules/auth/identity-guard.js';
import { context, memoryLogger } from './helpers.js';

const me = context({ userId: 'user-a' });

describe('IdentityGuard', () => {
  it('modo log: registra divergência sem trocar o valor nem expor os ids', () => {
    const { logger, entries } = memoryLogger();
    const params = new URLSearchParams({ userId: 'user-b' });

    new IdentityGuard('log', logger).applyToSearchParams(params, me, 'GET /api/team');

    expect(params.get('userId')).toBe('user-b');
    expect(entries).toHaveLength(1);
    expect(JSON.stringify(entries[0])).not.toContain('user-b');
    expect(JSON.stringify(entries[0])).not.toContain('user-a');
    expect(entries[0].context).toMatchObject({ field: 'userId', source: 'query', route: 'GET /api/team' });
  });

  it('modo enforce: identidade declarada por outro usuário vira a do token', () => {
    const { logger } = memoryLogger();
    const params = new URLSearchParams({ brokerUserId: 'user-b' });
    const body = { usuarioId: 'user-b', corretorUserId: 'user-b', titulo: 'x' };
    const guard = new IdentityGuard('enforce', logger);

    guard.applyToSearchParams(params, me, 'GET /api/proposals');
    guard.applyToBody(body, me, 'POST /api/proposals');

    expect(params.get('brokerUserId')).toBe('user-a');
    expect(body).toEqual({ usuarioId: 'user-a', corretorUserId: 'user-a', titulo: 'x' });
  });

  it('não mexe em campos de alvo da operação (ex.: targetUserId)', () => {
    const { logger, entries } = memoryLogger();
    const body = { userId: 'user-a', targetUserId: 'user-b' };

    new IdentityGuard('enforce', logger).applyToBody(body, me, 'PATCH /api/team/:id');

    expect(body.targetUserId).toBe('user-b');
    expect(entries).toHaveLength(0);
  });

  it('identidade igual à do token não gera log', () => {
    const { logger, entries } = memoryLogger();

    new IdentityGuard('log', logger).applyToSearchParams(
      new URLSearchParams({ userId: 'user-a' }),
      me,
      'GET /api/me',
    );

    expect(entries).toHaveLength(0);
  });
});

describe('routeLabel', () => {
  it('troca ids do caminho por :id para agrupar o log', () => {
    expect(routeLabel('GET', '/api/proposals/3f2a9c1e-1111-2222-3333-444455556666/documents')).toBe(
      'GET /api/proposals/:id/documents',
    );
  });
});
