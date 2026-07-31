import { toMinor, plain, percentOf, roundOffDelta, formatMoney } from '../src/lib/money';
import { previewNumber, scopeFor, dateParts, applyFormat } from '../src/lib/numberFormat';
import { toCsv, parseCsv, parseCsvObjects } from '../src/lib/csv';
import { startOfLocalDay, endOfLocalDay, tzOffsetMinutes } from '../src/lib/datetime';

let failures = 0;
const check = (name: string, actual: unknown, expected: unknown) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) { failures++; console.log(`FAIL ${name}\n  expected ${e}\n  actual   ${a}`); }
  else console.log(`pass  ${name}`);
};

// ---- money --------------------------------------------------------------
check('parse rupees', toMinor('125.50'), 12550);
check('parse with symbol', toMinor('\u20b9 1,250'), 125000);
check('parse blank', toMinor(''), 0);
check('plain formatting', plain(12550), '125.50');
check('plain pads paise', plain(12505), '125.05');
check('plain negative', plain(-500), '-5.00');
check('percent rounds half up', percentOf(9990, 5), 500);
check('round off to nearest unit', roundOffDelta(10490), 10);
check('round off down', roundOffDelta(10440), -40);
check('rupee formatting', formatMoney(125000, 'INR', 'en-IN').replace(/\u00a0/g, ' '), '\u20b91,250.00');

// ---- numbering ----------------------------------------------------------
const p = dateParts(new Date('2026-07-30T06:00:00Z'), 'Asia/Kolkata');
check('date parts in IST', [p.YYYY, p.YY, p.MM, p.DD], ['2026', '26', '07', '30']);
check('daily reset scope', scopeFor('INV-{YY}{MM}{DD}-{SEQ:4}', p), '20260730');
check('monthly reset scope', scopeFor('INV-{YY}{MM}-{SEQ:4}', p), '202607');
check('never resets', scopeFor('{SEQ:5}', p), 'all');
check('format applied', applyFormat('INV-{YY}{MM}{DD}-{SEQ:4}', 7, p), 'INV-260730-0007');
check('sequence padding', previewNumber('{SEQ:5}', 42, 'Asia/Kolkata'), '00042');
// Late-evening IST is the next day in UTC — the local date must still win.
const late = dateParts(new Date('2026-07-30T19:30:00Z'), 'Asia/Kolkata');
check('IST rollover uses local day', late.DD, '31');

// ---- csv ---------------------------------------------------------------
const csv = toCsv([['code', 'name'], ['ST01', 'Tikka, "special"']]);
check('csv quotes embedded commas', csv.includes('"Tikka, ""special"""'), true);
check('csv round trip', parseCsv(csv)[1], ['ST01', 'Tikka, "special"']);
check('csv objects lower-case headers', parseCsvObjects('Code,Name\nST01,Tikka')[0], { code: 'ST01', name: 'Tikka' });
check('csv skips blank rows', parseCsv('a,b\n\n1,2').length, 2);
check('csv handles newline in field', parseCsv('a,b\n"x\ny",2')[1], ['x\ny', '2']);

// ---- timezone bucketing ------------------------------------------------
check('IST is +330 minutes', tzOffsetMinutes(new Date('2026-07-30T00:00:00Z'), 'Asia/Kolkata'), 330);
const day = startOfLocalDay(new Date('2026-07-30T19:30:00Z'), 'Asia/Kolkata');
// 19:30 UTC on the 30th is 01:00 IST on the 31st, so the local day starts at
// 18:30 UTC on the 30th.
check('local day start', day.toISOString(), '2026-07-30T18:30:00.000Z');
check('local day is 24h', endOfLocalDay(new Date('2026-07-30T19:30:00Z'), 'Asia/Kolkata').getTime() - day.getTime(), 86_399_999);

console.log(failures === 0 ? '\nAll format tests passed.' : `\n${failures} test(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
