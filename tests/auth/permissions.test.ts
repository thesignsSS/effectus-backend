import { describe, expect, it } from 'vitest';
import {
  CompanySuspended,
  PermissionDenied,
  definePolicy,
  requireActiveCompany,
  sameCompany,
} from '../../src/app/modules/auth/permissions.js';
import type { AuthContext } from '../../src/app/modules/auth/auth-context.js';
import { context } from './helpers.js';

type Resource = { companyId: string; ownerId: string };

const policy = definePolicy({
  view: (ctx: AuthContext, r: Resource) => sameCompany(ctx, r),
  edit: (ctx: AuthContext, r: Resource) => sameCompany(ctx, r) && (ctx.isAdmin || ctx.userId === r.ownerId),
});

const ownResource: Resource = { companyId: 'company-a', ownerId: 'user-a' };

describe('definePolicy', () => {
  it('empresa A nunca alcança recurso da empresa B', () => {
    expect(policy.can(context({ isAdmin: true }), 'view', { companyId: 'company-b', ownerId: 'x' })).toBe(false);
  });

  it('usuário sem empresa não pode nada', () => {
    expect(policy.can(context({ companyId: null }), 'view', ownResource)).toBe(false);
  });

  it('aplica a regra do módulo', () => {
    expect(policy.can(context(), 'edit', ownResource)).toBe(true);
    expect(policy.can(context({ userId: 'user-c' }), 'edit', ownResource)).toBe(false);
    expect(policy.can(context({ userId: 'user-c', isAdmin: true }), 'edit', ownResource)).toBe(true);
  });

  it('assert lança PermissionDenied', () => {
    expect(() => policy.assert(context({ userId: 'user-c' }), 'edit', ownResource)).toThrow(PermissionDenied);
  });

  it('empresa sem direito de uso: can() nega e assert() avisa a suspensão (403 no app)', () => {
    const suspended = context({ isAdmin: true, companyBlockedReason: 'o período pago terminou' });

    expect(policy.can(suspended, 'view', ownResource)).toBe(false);
    expect(() => policy.assert(suspended, 'view', ownResource)).toThrow(/^Empresa suspensa: o período pago terminou/);
    expect(() => requireActiveCompany(suspended)).toThrow(CompanySuspended);
  });

  it('requireActiveCompany devolve a empresa do token', () => {
    expect(requireActiveCompany(context())).toBe('company-a');
    expect(() => requireActiveCompany(context({ companyId: null }))).toThrow(PermissionDenied);
  });
});
