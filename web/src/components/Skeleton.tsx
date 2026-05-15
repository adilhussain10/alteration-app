interface SkeletonProps {
  className?: string;
}

export function Skeleton({ className = '' }: SkeletonProps) {
  return <div className={`animate-pulse rounded bg-slate-200 ${className}`} />;
}

interface SkeletonRowProps {
  cols: number;
}

export function SkeletonRow({ cols }: SkeletonRowProps) {
  return (
    <div className="flex gap-3 py-2 animate-pulse">
      {Array.from({ length: cols }).map((_, i) => (
        <div key={i} className="h-4 flex-1 rounded bg-slate-200" />
      ))}
    </div>
  );
}
