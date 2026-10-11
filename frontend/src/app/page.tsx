// 商品列表 + 一键购买
// 用 server component 拉数据，buy 按钮用 client action
import { api, formatMoney, type Product } from '@/lib/api';
import BuyButton from './BuyButton';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const { data: products } = await api<{ data: Product[] }>('/api/products');

  return (
    <div className="space-y-6 py-4">
      <h1 className="text-2xl font-semibold">Bonnie Bags</h1>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {products.map((p) => (
          <article key={p.id} className="overflow-hidden rounded-xl border bg-white shadow-sm">
            {p.imageUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={p.imageUrl} alt={p.name} className="aspect-square w-full object-cover" />
            )}
            <div className="space-y-2 p-4">
              <h2 className="font-medium">{p.name}</h2>
              <p className="line-clamp-2 text-sm text-neutral-600">{p.description}</p>
              <div className="flex items-center justify-between pt-2">
                <span className="text-lg font-semibold">
                  {formatMoney(p.priceCents, p.currency)}
                </span>
                <BuyButton productId={p.id} />
              </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
