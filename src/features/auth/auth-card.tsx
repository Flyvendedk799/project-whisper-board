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
    <div className="grid min-h-screen place-items-center bg-background px-4 py-8">
      <div
        className={`w-full ${width} space-y-5 rounded-2xl border bg-card p-7 shadow-[0_12px_40px_-12px_rgb(0_0_0/0.12)] sm:p-9`}
      >
        <div className="space-y-1 text-center">
          <h1 className="font-display text-4xl leading-tight">{title}</h1>
          {subtitle ? <div className="text-sm text-muted-foreground">{subtitle}</div> : null}
        </div>
        {children}
      </div>
    </div>
  );
}
