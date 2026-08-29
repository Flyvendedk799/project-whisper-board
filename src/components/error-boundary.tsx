import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { captureError } from "@/lib/providers";
import { toUserMessage } from "@/lib/errors";

/**
 * A boundary around a section rather than the whole page.
 *
 * The only error boundary in the app was at the root, so one component
 * throwing — a malformed annotation, an unexpected null in a chart — blanked
 * the entire screen. Wrapping each tab and card means a failure costs you that
 * card, and the rest of the page keeps working.
 */

interface Props {
  children: ReactNode;
  /** Named in the error report so you can tell which section failed. */
  label: string;
  /** Replaces the default panel. Receives a retry that remounts the subtree. */
  fallback?: (error: unknown, retry: () => void) => ReactNode;
}

interface State {
  error: unknown;
}

export class SectionBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    captureError(error, {
      scope: "render",
      label: this.props.label,
      componentStack: info.componentStack,
    });
  }

  private retry = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback) return this.props.fallback(error, this.retry);

    return (
      <div
        role="alert"
        className="rounded-lg border border-destructive/30 bg-destructive/5 p-6 text-center"
      >
        <AlertTriangle className="mx-auto h-5 w-5 text-destructive" aria-hidden="true" />
        <p className="mt-2 font-medium">This section couldn&rsquo;t be shown</p>
        <p className="mt-1 text-sm text-muted-foreground">{toUserMessage(error)}</p>
        <Button variant="outline" size="sm" className="mt-4" onClick={this.retry}>
          <RefreshCw className="mr-1.5 h-4 w-4" aria-hidden="true" />
          Try again
        </Button>
      </div>
    );
  }
}
