import crypto from 'crypto';

import type { VertexServiceAccountKey } from '@/types';
import { env } from '@/lib/env';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

function deriveKey(): Buffer {
  return crypto.createHash('sha256').update(env.APP_SECRET).digest();
}

export function encrypt(text: string): string {
  if (!text) {
    throw new Error('Cannot encrypt empty text');
  }

  const key = deriveKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(text, 'utf8'),
    cipher.final()
  ]);
  const authTag = cipher.getAuthTag();
  return [
    iv.toString('hex'),
    authTag.toString('hex'),
    encrypted.toString('hex')
  ].join(':');
}

export function decrypt(encrypted: string): string {
  if (!encrypted) {
    throw new Error('Encrypted text is required');
  }

  const [ivHex, authTagHex, dataHex] = encrypted.split(':');
  if (!ivHex || !authTagHex || !dataHex) {
    throw new Error('Invalid encrypted format');
  }
  const key = deriveKey();
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const data = Buffer.from(dataHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return decipher.update(data, undefined, 'utf8') + decipher.final('utf8');
}

export function maskKey(text: string): string {
  if (text.length <= 8) return '••••••••';
  return text.slice(0, 4) + '••••••••' + text.slice(-4);
}

export function maskedKey(
  providerType: string,
  encrypted?: string | null
): string | VertexServiceAccountKey {
  let text = '';

  try {
    text = decrypt(encrypted || '');
  } catch {
    return '';
  }

  if (providerType === 'vertex') {
    let vertexKey: VertexServiceAccountKey | null = null;

    try {
      vertexKey = JSON.parse(text) as VertexServiceAccountKey;
    } catch {}

    if (vertexKey?.location && vertexKey.credentials) {
      return {
        location: vertexKey.location,
        credentials: {
          ...vertexKey.credentials,
          private_key_id: maskKey(vertexKey.credentials.private_key_id || ''),
          private_key: maskKey(vertexKey.credentials.private_key || '')
        }
      };
    }
  }

  return maskKey(text);
}
