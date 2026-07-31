import { notFound } from 'next/navigation';
import { requirePageSession } from '@/lib/session';
import { buildKot } from '@/lib/receipt';
import { KotSlip } from '@/components/Receipt';
import { PrintTrigger } from '@/components/PrintTrigger';
import { PrintToolbar } from '@/components/PrintToolbar';

export const dynamic = 'force-dynamic';

/**
 * Kitchen order ticket.
 *
 * `?batch=n` prints only the lines sent to the kitchen in that batch, which is
 * how an additional KOT for newly added items is produced. Omit it to print
 * every line on the order.
 */
export default async function KotPrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  // A page, not an API route: an expired session goes to the sign-in form and
  // comes back here, rather than throwing a 500 at the cashier.
  await requirePageSession(`/print/kot/${id}`);
  const sp = await searchParams;

  const widthParam = Number(Array.isArray(sp.w) ? sp.w[0] : sp.w);
  const width = widthParam === 58 ? 58 : widthParam === 80 ? 80 : undefined;
  const batchParam = Number(Array.isArray(sp.batch) ? sp.batch[0] : sp.batch);
  const batch = Number.isFinite(batchParam) && batchParam > 0 ? batchParam : undefined;

  const data = await buildKot(id, batch, width);
  if (!data || data.lines.length === 0) notFound();

  return (
    <>
      <style
        dangerouslySetInnerHTML={{
          __html: `@page { size: ${data.width}mm auto; margin: 0; }`,
        }}
      />
      <PrintToolbar
        width={data.width}
        title={`${data.kotLabel} — order ${data.orderNo}`}
        fileName={`KOT-${data.orderNo}-${data.batch}`}
      />
      <div className="flex justify-center pb-10 print:block print:pb-0">
        <div data-slip-root className="paper-shadow print:shadow-none">
          <KotSlip data={data} />
        </div>
      </div>
      <PrintTrigger auto={sp.auto === '1'} closeAfter={sp.close === '1'} />
    </>
  );
}
