import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button, InlineAlert } from './ui/index.js';

interface ErrorBoundaryProps {
  /** Says what could not be shown: "This screen", "Saved opportunities". */
  what: string;
  /** When this changes, the boundary tries again, for example when another screen is opened. */
  resetKey?: string;
  children: ReactNode;
}

interface ErrorBoundaryState {
  failed: boolean;
  resetKey: string | undefined;
}

/**
 * Keeps a fault in one part of the workspace from taking the rest of the app
 * with it. The workspace wraps every screen in one, and the dashboard wraps
 * each of its cards, so a screen that throws while rendering leaves the
 * navigation, the other cards and the assistant panel working, and offers a
 * way to try again.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { failed: false, resetKey: this.props.resetKey };

  static getDerivedStateFromError(): Partial<ErrorBoundaryState> {
    return { failed: true };
  }

  static getDerivedStateFromProps(
    props: ErrorBoundaryProps,
    state: ErrorBoundaryState,
  ): Partial<ErrorBoundaryState> | null {
    if (props.resetKey === state.resetKey) return null;
    return { failed: false, resetKey: props.resetKey };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[workspace] ${this.props.what} failed to render`, error, info.componentStack);
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <InlineAlert
        tone="error"
        action={
          <Button size="sm" onClick={() => this.setState({ failed: false })}>
            Try again
          </Button>
        }
      >
        {this.props.what} could not be shown.
      </InlineAlert>
    );
  }
}
