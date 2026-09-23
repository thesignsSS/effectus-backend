import { randomInt } from 'node:crypto';

// Sem caracteres ambíguos (0/O, 1/l/I) — a senha é lida e digitada por gente.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';

/** Gera uma senha temporária para o convite/redefinição de um usuário. */
export function generateTemporaryPassword(length = 12): string {
  let password = '';

  for (let i = 0; i < length; i += 1) {
    password += ALPHABET[randomInt(ALPHABET.length)];
  }

  return password;
}
