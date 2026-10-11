export default function PayCancelPage() {
  return (
    <div className="mx-auto max-w-md py-8 text-center">
      <h1 className="text-xl font-semibold">Payment cancelled</h1>
      <p className="pt-2 text-sm text-neutral-600">You can go back and try again.</p>
      <a href="/" className="mt-6 inline-block text-sm text-blue-600 hover:underline">
        ← Back to shop
      </a>
    </div>
  );
}
