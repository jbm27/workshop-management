import { randomBytes } from 'crypto';

/** Unguessable token for supplier-facing LPO verification links (stored on `lpos.public_verify_token`). */
export function newLpoPublicVerifyToken() {
  return randomBytes(24).toString('hex');
}
