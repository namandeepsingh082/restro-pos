import { prisma } from './db';

/**
 * Append-only audit trail. Never throws — a logging failure must not roll back
 * the business action that succeeded.
 */
export async function audit(entry: {
  actorId?: string | null;
  actorName?: string;
  action: string;
  entity: string;
  entityId?: string | null;
  meta?: unknown;
  ip?: string | null;
}) {
  try {
    await prisma.auditLog.create({
      data: {
        actorId: entry.actorId ?? null,
        actorName: entry.actorName ?? 'system',
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId ?? null,
        metaJson: JSON.stringify(entry.meta ?? {}),
        ip: entry.ip ?? null,
      },
    });
  } catch (err) {
    console.error('[audit] failed to record', entry.action, err);
  }
}
