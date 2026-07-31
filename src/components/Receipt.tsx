import type { ReceiptData, KotData } from '@/lib/receipt';
import { plain } from '@/lib/money';

/**
 * The paper.
 *
 * These components are used in two places with identical markup: the on-screen
 * preview on the billing screen and the print route. The preview is not an
 * approximation of the slip — it is the slip, at its real millimetre width, so
 * whatever fits on screen fits on the roll.
 *
 * Layout is a 4-column table (name / qty / rate / amount) rather than
 * space-padded text, because item names in mixed scripts do not pad reliably
 * with a character count.
 */

const VegMark = ({ isVeg }: { isVeg: boolean }) => (
  <span
    aria-label={isVeg ? 'Vegetarian' : 'Non-vegetarian'}
    style={{
      display: 'inline-block',
      width: '0.62em',
      height: '0.62em',
      border: `1px solid ${isVeg ? '#1B7F3B' : '#B3261E'}`,
      marginRight: '0.35em',
      position: 'relative',
      top: '-0.05em',
      lineHeight: 1,
    }}
  >
    <span
      style={{
        display: 'block',
        width: '0.3em',
        height: '0.3em',
        margin: '0.13em auto',
        borderRadius: '50%',
        background: isVeg ? '#1B7F3B' : '#B3261E',
      }}
    />
  </span>
);

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <tr className={bold ? 'b' : undefined}>
      <td colSpan={3}>{label}</td>
      <td className="r">{value}</td>
    </tr>
  );
}

export function Receipt({ data }: { data: ReceiptData }) {
  const r = data;
  const narrow = r.width === 58;

  return (
    <div className={`receipt receipt-${r.width}`} data-testid="receipt">
      {/* ---------------- header ---------------- */}
      <div className="c">
        {r.restaurant.logoDataUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={r.restaurant.logoDataUrl}
            alt=""
            style={{ maxWidth: narrow ? '32mm' : '44mm', maxHeight: '16mm', margin: '0 auto 1mm' }}
          />
        )}
        <div className="big">{r.restaurant.name}</div>
        {r.restaurant.addressLines.map((l, i) => (
          <div key={i}>{l}</div>
        ))}
        {r.restaurant.phone && <div>Ph: {r.restaurant.phone}</div>}
        {r.restaurant.gstNumber && <div>GSTIN: {r.restaurant.gstNumber}</div>}
      </div>

      <hr />

      {/* ---------------- bill meta ---------------- */}
      <table>
        <tbody>
          <tr>
            <td className="b">{r.billNo ? `Bill ${r.billNo}` : `Order ${r.orderNo}`}</td>
            <td className="r">{r.date}</td>
          </tr>
          <tr>
            <td>{r.billNo ? `Order ${r.orderNo}` : ''}</td>
            <td className="r">{r.time}</td>
          </tr>
          <tr>
            <td className="b">{r.orderType}</td>
            <td className="r">{r.tableNo ? `Table ${r.tableNo}` : ''}</td>
          </tr>
          <tr>
            <td colSpan={2}>Cashier: {r.cashier}</td>
          </tr>
          {r.customerName && (
            <tr>
              <td colSpan={2}>Name: {r.customerName}</td>
            </tr>
          )}
          {r.customerPhone && (
            <tr>
              <td colSpan={2}>Phone: {r.customerPhone}</td>
            </tr>
          )}
          {r.address && (
            <tr>
              <td colSpan={2}>Address: {r.address}</td>
            </tr>
          )}
        </tbody>
      </table>

      {r.isReprint && (
        <div className="c b" style={{ marginTop: '1mm' }}>
          *** REPRINT ***
        </div>
      )}
      {r.status === 'CANCELLED' && (
        <div className="c b" style={{ marginTop: '1mm' }}>
          *** CANCELLED ***
        </div>
      )}

      <hr />

      {/* ---------------- items ---------------- */}
      <table>
        <colgroup>
          <col style={{ width: narrow ? '44%' : '46%' }} />
          <col style={{ width: '12%' }} />
          <col style={{ width: narrow ? '20%' : '18%' }} />
          <col style={{ width: '24%' }} />
        </colgroup>
        <thead>
          <tr className="b">
            <td>Item</td>
            <td className="r">Qty</td>
            <td className="r">Rate</td>
            <td className="r">Amount</td>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td colSpan={4}>
              <hr />
            </td>
          </tr>
          {r.lines.map((l, i) => (
            <tr key={i}>
              <td>
                <VegMark isVeg={l.isVeg} />
                {l.name}
                {l.variant ? ` (${l.variant})` : ''}
                {l.addOns.map((a, j) => (
                  <div key={j} style={{ paddingLeft: '1.2em' }}>
                    + {a.name}
                    {a.price > 0 ? ` ${plain(a.price)}` : ''}
                  </div>
                ))}
                {l.instructions && (
                  <div style={{ paddingLeft: '1.2em' }}>* {l.instructions}</div>
                )}
                {l.isComplimentary && (
                  <div style={{ paddingLeft: '1.2em' }} className="b">
                    COMPLIMENTARY
                  </div>
                )}
              </td>
              <td className="r">{l.qty}</td>
              <td className="r">{plain(l.unitPrice)}</td>
              <td className="r">{plain(l.amount)}</td>
            </tr>
          ))}
          <tr>
            <td colSpan={4}>
              <hr />
            </td>
          </tr>

          {/* ---------------- totals ---------------- */}
          <Row label="Subtotal" value={plain(r.itemsSubtotal)} />
          {r.discountTotal > 0 && (
            <Row label={r.discountLabel} value={`-${plain(r.discountTotal)}`} />
          )}
          {r.packagingCharge > 0 && <Row label="Packaging" value={plain(r.packagingCharge)} />}
          {r.deliveryCharge > 0 && <Row label="Delivery" value={plain(r.deliveryCharge)} />}

          {r.taxBreakup.map((t) =>
            r.splitTax ? (
              [
                <Row
                  key={`c${t.pct}`}
                  label={`CGST ${t.pct / 2}%`}
                  value={plain(Math.round(t.amount / 2))}
                />,
                <Row
                  key={`s${t.pct}`}
                  label={`SGST ${t.pct / 2}%`}
                  value={plain(t.amount - Math.round(t.amount / 2))}
                />,
              ]
            ) : (
              <Row key={t.pct} label={`Tax ${t.pct}%`} value={plain(t.amount)} />
            ),
          )}

          {r.roundOff !== 0 && (
            <Row label="Round off" value={`${r.roundOff > 0 ? '+' : ''}${plain(r.roundOff)}`} />
          )}
          <tr>
            <td colSpan={4}>
              <hr className="rule-solid" />
            </td>
          </tr>
          <tr className="b" style={{ fontSize: '1.15em' }}>
            <td colSpan={3}>TOTAL</td>
            <td className="r">{plain(r.grandTotal)}</td>
          </tr>
          <tr>
            <td colSpan={4}>
              <hr className="rule-solid" />
            </td>
          </tr>
        </tbody>
      </table>

      {/* ---------------- payment ---------------- */}
      <table>
        <tbody>
          {r.payments.map((p, i) => (
            <tr key={i}>
              <td>
                {p.label}
                {p.reference ? ` (${p.reference})` : ''}
              </td>
              <td className="r">{plain(p.amount)}</td>
            </tr>
          ))}
          <tr className="b">
            <td>{r.paymentStatus === 'PAID' ? 'PAID' : r.paymentStatus === 'PARTIAL' ? 'PART PAID' : 'UNPAID'}</td>
            <td className="r">{plain(r.paidTotal)}</td>
          </tr>
          {r.balanceDue > 0 && (
            <tr className="b">
              <td>BALANCE DUE</td>
              <td className="r">{plain(r.balanceDue)}</td>
            </tr>
          )}
          {r.refundedTotal > 0 && (
            <tr className="b">
              <td>REFUNDED</td>
              <td className="r">-{plain(r.refundedTotal)}</td>
            </tr>
          )}
        </tbody>
      </table>

      {r.instructions && (
        <>
          <hr />
          <div>Note: {r.instructions}</div>
        </>
      )}

      <hr />
      <div className="c">
        {r.restaurant.footer && <div>{r.restaurant.footer}</div>}
        {r.restaurant.fssaiNumber && <div>FSSAI: {r.restaurant.fssaiNumber}</div>}
        {r.restaurant.email && <div>{r.restaurant.email}</div>}
      </div>
    </div>
  );
}

export function KotSlip({ data }: { data: KotData }) {
  const k = data;
  return (
    <div className={`receipt receipt-${k.width}`} data-testid="kot">
      <div className="c">
        <div className="big">{k.kotLabel}</div>
        <div>{k.restaurantName}</div>
      </div>
      <hr className="rule-solid" />
      <table>
        <tbody>
          <tr className="b" style={{ fontSize: '1.2em' }}>
            <td>{k.orderType}</td>
            <td className="r">{k.tableNo ? `TABLE ${k.tableNo}` : ''}</td>
          </tr>
          <tr>
            <td>Order {k.orderNo}</td>
            <td className="r">{k.time}</td>
          </tr>
          {k.customerName && (
            <tr>
              <td colSpan={2}>{k.customerName}</td>
            </tr>
          )}
        </tbody>
      </table>
      <hr className="rule-solid" />

      {/* Quantity leads the line — the cook reads the number first. No prices
          appear anywhere on this slip. */}
      <table>
        <colgroup>
          <col style={{ width: '18%' }} />
          <col style={{ width: '82%' }} />
        </colgroup>
        <tbody>
          {k.lines.map((l, i) => (
            <tr key={i}>
              <td className="b" style={{ fontSize: '1.3em' }}>
                {l.qty} x
              </td>
              <td>
                <span className="b" style={{ fontSize: '1.15em' }}>
                  {l.name}
                  {l.variant ? ` (${l.variant})` : ''}
                </span>
                {l.addOns.map((a, j) => (
                  <div key={j}>+ {a}</div>
                ))}
                {l.instructions && <div className="b">** {l.instructions}</div>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {k.instructions && (
        <>
          <hr />
          <div className="b">Order note: {k.instructions}</div>
        </>
      )}
      <hr className="rule-solid" />
      <div className="c">
        {k.date} {k.time} — {k.cashier}
      </div>
    </div>
  );
}
