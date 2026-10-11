import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'icey-shopping',
  description: 'Bonnie bags store',
};

// 响应式关键：meta viewport，让 PC/手机同一套页面都正确缩放
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-neutral-50 text-neutral-900">
        <header className="border-b bg-white">
          <div className="mx-auto flex max-w-5xl items-center justify-between p-4">
            <a href="/" className="text-lg font-semibold">icey · Bonnie</a>
            <nav className="text-sm text-neutral-600">H5 Checkout Demo</nav>
          </div>
        </header>
        <main className="mx-auto max-w-5xl p-4">{children}</main>
      </body>
    </html>
  );
}
