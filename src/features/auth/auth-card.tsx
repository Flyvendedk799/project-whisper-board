/**
 * The centred card every public form sits in: serif title, one line of
 * context, then the form. One place so sign in, sign up, reset, invite and
 * workspace creation cannot drift apart.
 */
export function AuthCard({
  title,
  subtitle,
  children,
  width = "max-w-md",
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  width?: string;
}) {
  return (
    <div className="grid min-h-screen place-items-center bg-background px-4 py-8 max-md:min-h-dvh max-md:items-start max-md:px-0 max-md:py-0">
      <div
        className={`w-full ${width} space-y-5 rounded-2xl border bg-card p-7 shadow-[0_12px_40px_-12px_rgb(0_0_0/0.12)] md:p-9 max-md:space-y-6 max-md:rounded-none max-md:border-0 max-md:bg-background max-md:px-5 max-md:pb-[calc(2rem+var(--safe-bottom))] max-md:pt-[calc(2.5rem+var(--safe-top))] max-md:shadow-none`}
      >
        <div className="space-y-1 text-center">
          <h1 className="font-display text-4xl leading-tight max-md:text-[32px]">{title}</h1>
          {subtitle ? <div className="text-sm text-muted-foreground">{subtitle}</div> : null}
        </div>
        {children}
      </div>
    </div>
  );
}
