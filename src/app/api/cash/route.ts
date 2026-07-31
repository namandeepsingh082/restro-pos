import { prisma } from '@/lib/db';
import { requirePermission, HttpError } from '@/lib/session';
import { ok, handler } from '@/lib/api';
import { z } from 'zod';
import { getSettings } from '@/lib/settings';
import { startOfLocalDay } from '@/lib/datetime';
import { audit } from '@/lib/audit';
import { PERMISSIONS, VOID_STATUSES } from '@/lib/constants';

const money = z.number().int().min(0);
const openSchema = z.object({ action: z.literal('open'), openingCash: money, note: z.string().max(200).default('') });
const txnSchema = z.object({ action: z.literal('txn'), kind: z.enum(['ADD', 'EXPENSE']), amount: money, note: z.string().max(200).default('') });
const closeSchema = z.object({ action: z.literal('close'), closingCash: money, note: z.string().max(200).default('') });
const bodySchema = z.discriminatedUnion('action', [openSchema, txnSchema, closeSchema]);

/**
 * Cash counted in the drawer versus cash the system says should be there.
 *
 * This models ONE physical drawer per outlet: every cash payment taken while the
 * session is open counts towards it, whoever rang it up. For a second till, add
 * a `registerId` to Payment and filter on it here.
 */
async function expectedCash(sessionRow: { id: string; openingCash: number; openedAt: Date }) {
  const [cashIn, txns, refunds] = await Promise.all([
    prisma.payment.aggregate({
      where: {
        method: 'CASH',
        createdAt: { gte: sessionRow.openedAt },
        order: { status: { notIn: VOID_STATUSES } },
      },
      _sum: { amount: true },
    }),
    prisma.cashTransaction.groupBy({
      by: ['kind'],
      where: { sessionId: sessionRow.id },
      _sum: { amount: true },
    }),
    prisma.refund.aggregate({
      where: { method: 'CASH', createdAt: { gte: sessionRow.openedAt } },
      _sum: { amount: true },
    }),
  ]);

  const added = txns.find((t) => t.kind === 'ADD')?._sum.amount ?? 0;
  const expense = txns.find((t) => t.kind === 'EXPENSE')?._sum.amount ?? 0;
  const cashSales = cashIn._sum.amount ?? 0;
  const cashRefunds = refunds._sum.amount ?? 0;

  return {
    openingCash: sessionRow.openingCash,
    cashSales,
    cashAdded: added,
    cashExpenses: expense,
    cashRefunds,
    // opening + sales + added - expenses - refunds
    expected: sessionRow.openingCash + cashSales + added - expense - cashRefunds,
  };
}

export const GET = handler(async () => {
  await requirePermission(PERMISSIONS.CASH_REGISTER);
  const settings = await getSettings();

  const open = await prisma.cashRegisterSession.findFirst({
    where: { closedAt: null },
    orderBy: { openedAt: 'desc' },
    include: {
      openedBy: { select: { name: true } },
      transactions: { orderBy: { createdAt: 'desc' }, include: { createdBy: { select: { name: true } } } },
    },
  });

  const recent = await prisma.cashRegisterSession.findMany({
    where: { closedAt: { not: null }, openedAt: { gte: startOfLocalDay(new Date(), settings.timeZone) } },
    orderBy: { openedAt: 'desc' },
    take: 5,
    include: { openedBy: { select: { name: true } } },
  });

  return ok({ open: open ? { ...open, ...(await expectedCash(open)) } : null, recent });
});

export const POST = handler(async (req: Request) => {
  const session = await requirePermission(PERMISSIONS.CASH_REGISTER);
  const body = bodySchema.parse(await req.json());

  const current = await prisma.cashRegisterSession.findFirst({
    where: { closedAt: null }, orderBy: { openedAt: 'desc' },
  });

  if (body.action === 'open') {
    if (current) throw new HttpError(409, 'A register session is already open. Close it first.');
    const row = await prisma.cashRegisterSession.create({
      data: { openedById: session.sub, openingCash: body.openingCash, note: body.note },
    });
    await audit({
      actorId: session.sub, actorName: session.name,
      action: 'cash.open', entity: 'CashRegisterSession', entityId: row.id,
      meta: { openingCash: body.openingCash },
    });
    return ok(row, { status: 201 });
  }

  if (!current) throw new HttpError(409, 'Open the register before recording cash movements.');

  if (body.action === 'txn') {
    const row = await prisma.cashTransaction.create({
      data: {
        sessionId: current.id, kind: body.kind, amount: body.amount,
        note: body.note, createdById: session.sub,
      },
    });
    await audit({
      actorId: session.sub, actorName: session.name,
      action: body.kind === 'ADD' ? 'cash.add' : 'cash.expense',
      entity: 'CashTransaction', entityId: row.id,
      meta: { amount: body.amount, note: body.note },
    });
    return ok(row, { status: 201 });
  }

  // close
  const calc = await expectedCash(current);
  const row = await prisma.cashRegisterSession.update({
    where: { id: current.id },
    data: {
      closingCash: body.closingCash,
      expectedCash: calc.expected,
      difference: body.closingCash - calc.expected,
      closedAt: new Date(),
      note: body.note || current.note,
    },
  });
  await audit({
    actorId: session.sub, actorName: session.name,
    action: 'cash.close', entity: 'CashRegisterSession', entityId: row.id,
    meta: { ...calc, closingCash: body.closingCash, difference: row.difference },
  });
  return ok({ ...row, ...calc });
});
