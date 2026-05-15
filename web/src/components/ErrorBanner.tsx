interface ErrorBannerProps {
  error: Error;
}

export function ErrorBanner({ error }: ErrorBannerProps) {
  return (
    <div className="my-3 flex items-start gap-2 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
      <span aria-hidden>⚠</span>
      <div className="min-w-0">
        <div className="font-semibold">Something went wrong</div>
        <div className="opacity-80 break-words">{error.message}</div>
      </div>
    </div>
  );
}
