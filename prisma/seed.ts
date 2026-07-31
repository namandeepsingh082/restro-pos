/**
 * Seed script — safe to run repeatedly (everything is upserted).
 *   npm run db:seed
 *
 * Creates: 2 roles, 1 admin + 1 cashier, the settings row, 3 tax rates,
 * 7 categories and ~40 menu items with variants and add-ons.
 */

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { CASHIER_PERMISSIONS, PERMISSIONS } from '../src/lib/constants';

const prisma = new PrismaClient();

/** Rupees -> paise, so the menu below stays readable. */
const rs = (rupees: number) => Math.round(rupees * 100);

async function main() {
  // ---------------------------------------------------------------- roles
  const adminRole = await prisma.role.upsert({
    where: { key: 'ADMIN' },
    update: { permissions: JSON.stringify(Object.values(PERMISSIONS)) },
    create: {
      key: 'ADMIN',
      name: 'Administrator',
      permissions: JSON.stringify(Object.values(PERMISSIONS)),
    },
  });

  const cashierRole = await prisma.role.upsert({
    where: { key: 'CASHIER' },
    update: { permissions: JSON.stringify(CASHIER_PERMISSIONS) },
    create: {
      key: 'CASHIER',
      name: 'Cashier',
      permissions: JSON.stringify(CASHIER_PERMISSIONS),
    },
  });

  // ---------------------------------------------------------------- users
  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? 'admin@restaurant.local';
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? 'admin@123';
  const cashierEmail = process.env.SEED_CASHIER_EMAIL ?? 'cashier@restaurant.local';
  const cashierPassword = process.env.SEED_CASHIER_PASSWORD ?? 'cashier@123';

  await prisma.user.upsert({
    where: { email: adminEmail },
    update: { roleId: adminRole.id, active: true },
    create: {
      name: 'Owner',
      email: adminEmail,
      passwordHash: await bcrypt.hash(adminPassword, 10),
      roleId: adminRole.id,
      maxDiscountPct: 100,
      maxDiscountAmt: rs(100000),
    },
  });

  await prisma.user.upsert({
    where: { email: cashierEmail },
    update: { roleId: cashierRole.id, active: true },
    create: {
      name: 'Counter 1',
      email: cashierEmail,
      passwordHash: await bcrypt.hash(cashierPassword, 10),
      roleId: cashierRole.id,
      // A cashier may give up to 10% or ₹100 without asking the owner.
      maxDiscountPct: 10,
      maxDiscountAmt: rs(100),
    },
  });

  // ------------------------------------------------------------- settings
  await prisma.restaurantSettings.upsert({
    where: { id: 1 },
    update: {},
    create: {
      id: 1,
      name: 'Spice Garden Restaurant',
      addressLine1: 'Shop 4, Ground Floor, Main Market',
      addressLine2: 'Kothrud',
      city: 'Pune 411038',
      phone: '+91 98000 00000',
      email: 'orders@example.com',
      gstNumber: '27ABCDE1234F1Z5',
      receiptFooter: 'Thank you! Please visit again.',
      receiptWidth: 80,
      defaultTaxPct: 5,
      defaultPackagingChg: rs(10),
      defaultDeliveryChg: rs(30),
      billNumberFormat: 'INV-{YY}{MM}{DD}-{SEQ:4}',
      orderNumberFormat: '{SEQ:5}',
      kotNumberFormat: 'K-{SEQ:4}',
    },
  });

  // ----------------------------------------------------------------- taxes
  const taxes = [
    { name: 'GST 5%', percent: 5, isDefault: true },
    { name: 'GST 12%', percent: 12, isDefault: false },
    { name: 'GST 18%', percent: 18, isDefault: false },
    { name: 'Exempt', percent: 0, isDefault: false },
  ];
  for (const t of taxes) {
    const found = await prisma.tax.findFirst({ where: { name: t.name } });
    if (!found) await prisma.tax.create({ data: t });
  }

  // ------------------------------------------------------------ categories
  const categories = [
    { name: 'Starters', sortOrder: 1, prepArea: 'Tandoor' },
    { name: 'Main Course', sortOrder: 2, prepArea: 'Kitchen' },
    { name: 'Breads', sortOrder: 3, prepArea: 'Tandoor' },
    { name: 'Rice', sortOrder: 4, prepArea: 'Kitchen' },
    { name: 'Beverages', sortOrder: 5, prepArea: 'Counter' },
    { name: 'Desserts', sortOrder: 6, prepArea: 'Counter' },
    { name: 'Combos', sortOrder: 7, prepArea: 'Kitchen' },
  ];
  const catByName: Record<string, string> = {};
  for (const c of categories) {
    const row = await prisma.menuCategory.upsert({
      where: { name: c.name },
      update: { sortOrder: c.sortOrder, prepArea: c.prepArea },
      create: c,
    });
    catByName[c.name] = row.id;
  }

  // ------------------------------------------------------------ menu items
  type SeedItem = {
    code: string; name: string; cat: string; price: number; veg: boolean;
    taxPct?: number; desc?: string;
    variants?: { name: string; price: number }[];
    addOns?: { name: string; price: number }[];
  };

  const items: SeedItem[] = [
    // Starters
    { code: 'ST01', name: 'Paneer Tikka', cat: 'Starters', price: rs(260), veg: true, variants: [{ name: 'Half', price: rs(150) }, { name: 'Full', price: rs(260) }], addOns: [{ name: 'Extra Chutney', price: rs(20) }] },
    { code: 'ST02', name: 'Veg Manchurian', cat: 'Starters', price: rs(190), veg: true, variants: [{ name: 'Dry', price: rs(190) }, { name: 'Gravy', price: rs(210) }] },
    { code: 'ST03', name: 'Hara Bhara Kebab', cat: 'Starters', price: rs(210), veg: true },
    { code: 'ST04', name: 'Chilli Paneer', cat: 'Starters', price: rs(230), veg: true },
    { code: 'ST05', name: 'Chicken Tikka', cat: 'Starters', price: rs(310), veg: false, variants: [{ name: 'Half', price: rs(180) }, { name: 'Full', price: rs(310) }] },
    { code: 'ST06', name: 'Tandoori Chicken', cat: 'Starters', price: rs(420), veg: false, variants: [{ name: 'Half', price: rs(240) }, { name: 'Full', price: rs(420) }] },
    { code: 'ST07', name: 'Chicken Lollipop', cat: 'Starters', price: rs(280), veg: false },
    { code: 'ST08', name: 'Crispy Corn', cat: 'Starters', price: rs(170), veg: true },

    // Main Course
    { code: 'MC01', name: 'Dal Makhani', cat: 'Main Course', price: rs(240), veg: true, addOns: [{ name: 'Extra Butter', price: rs(20) }, { name: 'Extra Cream', price: rs(25) }] },
    { code: 'MC02', name: 'Paneer Butter Masala', cat: 'Main Course', price: rs(280), veg: true, variants: [{ name: 'Half', price: rs(160) }, { name: 'Full', price: rs(280) }] },
    { code: 'MC03', name: 'Kadhai Paneer', cat: 'Main Course', price: rs(270), veg: true },
    { code: 'MC04', name: 'Palak Paneer', cat: 'Main Course', price: rs(260), veg: true },
    { code: 'MC05', name: 'Chana Masala', cat: 'Main Course', price: rs(200), veg: true },
    { code: 'MC06', name: 'Mix Veg', cat: 'Main Course', price: rs(220), veg: true },
    { code: 'MC07', name: 'Butter Chicken', cat: 'Main Course', price: rs(340), veg: false, variants: [{ name: 'Half', price: rs(200) }, { name: 'Full', price: rs(340) }] },
    { code: 'MC08', name: 'Chicken Curry', cat: 'Main Course', price: rs(300), veg: false },
    { code: 'MC09', name: 'Mutton Rogan Josh', cat: 'Main Course', price: rs(420), veg: false, taxPct: 5 },
    { code: 'MC10', name: 'Egg Curry', cat: 'Main Course', price: rs(210), veg: false },

    // Breads
    { code: 'BR01', name: 'Tandoori Roti', cat: 'Breads', price: rs(25), veg: true, addOns: [{ name: 'Butter', price: rs(10) }] },
    { code: 'BR02', name: 'Butter Naan', cat: 'Breads', price: rs(55), veg: true },
    { code: 'BR03', name: 'Garlic Naan', cat: 'Breads', price: rs(70), veg: true },
    { code: 'BR04', name: 'Laccha Paratha', cat: 'Breads', price: rs(60), veg: true },
    { code: 'BR05', name: 'Amritsari Kulcha', cat: 'Breads', price: rs(80), veg: true },
    { code: 'BR06', name: 'Missi Roti', cat: 'Breads', price: rs(45), veg: true },

    // Rice
    { code: 'RC01', name: 'Steamed Rice', cat: 'Rice', price: rs(110), veg: true },
    { code: 'RC02', name: 'Jeera Rice', cat: 'Rice', price: rs(140), veg: true },
    { code: 'RC03', name: 'Veg Biryani', cat: 'Rice', price: rs(230), veg: true, variants: [{ name: 'Half', price: rs(140) }, { name: 'Full', price: rs(230) }] },
    { code: 'RC04', name: 'Chicken Biryani', cat: 'Rice', price: rs(290), veg: false, variants: [{ name: 'Half', price: rs(170) }, { name: 'Full', price: rs(290) }], addOns: [{ name: 'Extra Raita', price: rs(30) }] },
    { code: 'RC05', name: 'Veg Pulao', cat: 'Rice', price: rs(180), veg: true },

    // Beverages
    { code: 'BV01', name: 'Masala Chai', cat: 'Beverages', price: rs(30), veg: true, taxPct: 5 },
    { code: 'BV02', name: 'Sweet Lassi', cat: 'Beverages', price: rs(80), veg: true, variants: [{ name: 'Small', price: rs(60) }, { name: 'Large', price: rs(80) }] },
    { code: 'BV03', name: 'Salted Lassi', cat: 'Beverages', price: rs(70), veg: true },
    { code: 'BV04', name: 'Fresh Lime Soda', cat: 'Beverages', price: rs(70), veg: true },
    { code: 'BV05', name: 'Cold Coffee', cat: 'Beverages', price: rs(120), veg: true, taxPct: 18 },
    { code: 'BV06', name: 'Mineral Water 1L', cat: 'Beverages', price: rs(20), veg: true, taxPct: 0 },
    { code: 'BV07', name: 'Soft Drink', cat: 'Beverages', price: rs(40), veg: true, taxPct: 12 },

    // Desserts
    { code: 'DS01', name: 'Gulab Jamun (2 pc)', cat: 'Desserts', price: rs(90), veg: true },
    { code: 'DS02', name: 'Gajar Halwa', cat: 'Desserts', price: rs(110), veg: true },
    { code: 'DS03', name: 'Rasmalai (2 pc)', cat: 'Desserts', price: rs(120), veg: true },
    { code: 'DS04', name: 'Vanilla Ice Cream', cat: 'Desserts', price: rs(70), veg: true, taxPct: 18 },

    // Combos
    { code: 'CB01', name: 'Veg Thali', cat: 'Combos', price: rs(260), veg: true, desc: '2 sabzi, dal, 3 roti, rice, salad, sweet' },
    { code: 'CB02', name: 'Non-Veg Thali', cat: 'Combos', price: rs(340), veg: false, desc: 'Chicken curry, dal, 3 roti, rice, salad' },
    { code: 'CB03', name: 'Student Combo', cat: 'Combos', price: rs(150), veg: true, desc: 'Dal, rice, 2 roti, pickle' },
  ];

  for (const [i, it] of items.entries()) {
    const item = await prisma.menuItem.upsert({
      where: { code: it.code },
      update: {
        name: it.name,
        price: it.price,
        categoryId: catByName[it.cat],
        isVeg: it.veg,
        taxPct: it.taxPct ?? null,
        description: it.desc ?? '',
      },
      create: {
        code: it.code,
        name: it.name,
        description: it.desc ?? '',
        categoryId: catByName[it.cat],
        price: it.price,
        isVeg: it.veg,
        taxPct: it.taxPct ?? null,
        sortOrder: i,
      },
    });

    for (const [vi, v] of (it.variants ?? []).entries()) {
      await prisma.menuItemVariant.upsert({
        where: { menuItemId_name: { menuItemId: item.id, name: v.name } },
        update: { price: v.price, sortOrder: vi },
        create: { menuItemId: item.id, name: v.name, price: v.price, sortOrder: vi },
      });
    }
    for (const a of it.addOns ?? []) {
      await prisma.menuItemAddOn.upsert({
        where: { menuItemId_name: { menuItemId: item.id, name: a.name } },
        update: { price: a.price },
        create: { menuItemId: item.id, name: a.name, price: a.price },
      });
    }
  }

  // ------------------------------------------------------- sample discounts
  const discounts = [
    { name: 'Regular customer 10%', kind: 'PERCENT', value: 10, code: null, maxDiscount: rs(200) },
    { name: 'Flat ₹50 off', kind: 'FIXED', value: rs(50), code: null, minOrder: rs(500) },
    { name: 'WELCOME15', kind: 'COUPON', value: 15, code: 'WELCOME15', maxDiscount: rs(150), minOrder: rs(400) },
  ];
  for (const d of discounts) {
    const found = await prisma.discount.findFirst({ where: { name: d.name } });
    if (!found) await prisma.discount.create({ data: d });
  }

  console.log('Seed complete.');
  console.log(`  Admin   : ${adminEmail} / ${adminPassword}`);
  console.log(`  Cashier : ${cashierEmail} / ${cashierPassword}`);
  console.log('  Change both passwords before going live.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
