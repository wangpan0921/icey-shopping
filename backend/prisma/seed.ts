// 开发种子数据：几款示例邦尼包商品
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const products = [
    {
      sku: 'BONNIE-CLASSIC-BLACK',
      name: 'Bonnie Classic Tote - Black',
      description: 'Minimalist leather tote, 10L, water resistant.',
      priceCents: 12900, // $129.00
      currency: 'usd',
      imageUrl: 'https://picsum.photos/seed/bonnie-black/600/600',
    },
    {
      sku: 'BONNIE-CLASSIC-BEIGE',
      name: 'Bonnie Classic Tote - Beige',
      description: 'Minimalist leather tote, 10L, water resistant.',
      priceCents: 12900,
      currency: 'usd',
      imageUrl: 'https://picsum.photos/seed/bonnie-beige/600/600',
    },
    {
      sku: 'BONNIE-MINI-TAN',
      name: 'Bonnie Mini Crossbody - Tan',
      description: 'Compact crossbody for daily essentials.',
      priceCents: 8900, // $89.00
      currency: 'usd',
      imageUrl: 'https://picsum.photos/seed/bonnie-tan/600/600',
    },
    {
      sku: 'BONNIE-WEEKENDER-NAVY',
      name: 'Bonnie Weekender - Navy',
      description: '35L weekender duffle, cabin size.',
      priceCents: 19900, // $199.00
      currency: 'usd',
      imageUrl: 'https://picsum.photos/seed/bonnie-navy/600/600',
    },
  ];

  for (const p of products) {
    await prisma.product.upsert({
      where: { sku: p.sku },
      update: p,
      create: p,
    });
  }

  const count = await prisma.product.count();
  console.log(`[seed] products in db: ${count}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
