import { notFound } from 'next/navigation';
import { requirePageSession } from '@/lib/session';
import { buildReceipt, receiptToText } from '@/lib/receipt';
import { Receipt } from '@/components/Receipt';
import { PrintTrigger } from '@/components/PrintTrigger';
import { PrintToolbar } from '@/components/PrintToolbar';

export const dynamic = 'force-dynamic';

/**
 * The customer bill.
 *
 * `?w=58|80`   paper width
 * `?auto=1`    open the print dialog immediately
 * `?close=1`   close the window after printing (script-opened windows only)
 * `?reprint=1` stamp the slip as a reprint
 */
export default async function BillPrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  // A page, not an API route: an expired session goes to the sign-in form and
  // comes back here, rather than throwing a 500 at the cashier.
  await requirePageSession(`/print/bill/${id}`);
  const sp = await searchParams;

  const widthParam = Number(Array.isArray(sp.w) ? sp.w[0] : sp.w);
  const width = widthParam === 58 ? 58 : widthParam === 80 ? 80 : undefined;
  const isReprint = sp.reprint === '1';

  const data = await buildReceipt(id, width, isReprint);
  if (!data) notFound();

  return (
    <>
      {/* Page size must match the roll exactly, with no margin, or the printer
          feeds a blank page after every bill. */}
      <style
        dangerouslySetInnerHTML={{
          __html: `@page { size: ${data.width}mm auto; margin: 0; }`,
        }}
      />
      <PrintToolbar
        width={data.width}
        title={`Bill ${data.billNo ?? data.orderNo}`}
        fileName={`Bill-${data.billNo ?? data.orderNo}`}
        whatsappText={receiptToText(data)}
        phone={data.customerPhone}
        repeatHref={`/billing?repeat=${id}`}
      />
      <div className="flex justify-center pb-10 print:block print:pb-0">
        <div data-slip-root className="paper-shadow print:shadow-none">
          <Receipt data={data} />
        </div>
      </div>
      <PrintTrigger auto={sp.auto === '1'} closeAfter={sp.close === '1'} />
    </>
  );
}
