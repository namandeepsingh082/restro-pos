import { clearSessionCookie, getSession } from '@/lib/session';
import { ok, handler } from '@/lib/api';
import { audit } from '@/lib/audit';

export const POST = handler(async () => {
  const session = await getSession();
  await clearSessionCookie();
  if (session) {
    await audit({
      actorId: session.sub, actorName: session.name,
      action: 'auth.logout', entity: 'User', entityId: session.sub,
    });
  }
  return ok({ signedOut: true });
});
