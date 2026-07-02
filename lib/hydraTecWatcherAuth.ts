import { randomBytes } from 'crypto';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';

/**
 * Issuance + verification for local HydraTec watcher API keys. Each key is a
 * named, revocable credential a small PowerShell script on a HydraLIST PC
 * uses to push .hvuf exports to this app over HTTPS — no Microsoft account
 * or OneDrive involved. The raw secret is shown to the admin exactly once
 * (at creation/regeneration) and never persisted; only its bcrypt hash is
 * stored, matching how user passwords are hashed elsewhere in this app.
 */

const KEY_PREFIX_LENGTH = 8;
const BCRYPT_SALT_ROUNDS = 10;

export type GeneratedWatcherKey = {
  secret: string;
  keyHash: string;
  keyPrefix: string;
};

export async function generateWatcherKey(): Promise<GeneratedWatcherKey> {
  const secret = randomBytes(32).toString('base64url');
  const keyHash = await bcrypt.hash(secret, BCRYPT_SALT_ROUNDS);
  const keyPrefix = secret.slice(0, KEY_PREFIX_LENGTH);
  return { secret, keyHash, keyPrefix };
}

function extractBearerToken(authHeader: string | null): string | null {
  if (!authHeader) return null;
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

export async function verifyWatcherKey(authHeader: string | null) {
  const token = extractBearerToken(authHeader);
  if (!token || token.length < KEY_PREFIX_LENGTH) return null;

  const keyPrefix = token.slice(0, KEY_PREFIX_LENGTH);
  const candidates = await (prisma as any).hydraTecWatcherKey.findMany({
    where: { keyPrefix, revokedAt: null },
  });

  for (const candidate of candidates) {
    if (await bcrypt.compare(token, candidate.keyHash)) {
      return candidate;
    }
  }
  return null;
}

export async function touchWatcherKeyLastSeen(id: string): Promise<void> {
  await (prisma as any).hydraTecWatcherKey.update({
    where: { id },
    data: { lastSeenAt: new Date() },
  });
}
