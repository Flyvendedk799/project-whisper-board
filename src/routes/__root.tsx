import type { QueryClient } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import type { ErrorComponentProps } from "@tanstack/react-router";

import appCss from "../styles.css?url";
import { AppProviders } from "@/components/app-providers";
import { THEME_SCRIPT } from "@/components/theme-provider";
import { captureError } from "@/lib/providers";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

// Take the router's own props type rather than restating it. `error` is typed
// `Error` in some versions of @tanstack/router-core and `unknown` in others, so
// a hand-written `{ error: Error }` compiles against whichever one happens to be
// installed and fails against the other — which is exactly how this broke in CI
// while passing locally. `captureError` accepts `unknown` either way.
function ErrorComponent({ error, reset }: ErrorComponentProps) {
  const router = useRouter();
  captureError(error, { scope: "route" });

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

const TITLE = "Consflow — Client portal & ticket platform";
const DESCRIPTION =
  "Consflow is where your clients report bugs with a screenshot and a screen recording, " +
  "follow their project from quote to invoice, and where you run every engagement from one queue.";

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { name: "application-name", content: "Consflow" },
      { name: "theme-color", content: "#faf6f0" },
      { property: "og:site_name", content: "Consflow" },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { property: "og:image", content: "/og.png" },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: TITLE },
      { name: "twitter:description", content: DESCRIPTION },
      { name: "twitter:image", content: "/og.png" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: the inline script below sets `class="dark"`
    // before React sees the document, so the server markup will not match.
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
        {/* Blocking, before first paint. Without it every load flashes white
            before the dark theme is applied. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <a
          href="#main"
          className="sr-only rounded-md focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:bg-background focus:px-4 focus:py-2 focus:ring-2 focus:ring-ring"
        >
          Skip to content
        </a>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <AppProviders queryClient={queryClient}>
      <Outlet />
    </AppProviders>
  );
}
