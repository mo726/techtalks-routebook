import type { ReactNode } from "react";
import { Alert } from "./alert";
import { Button } from "./button";

type ErrorStateProps = {
  title: string;
  message: ReactNode;
  onRetry?: () => void;
  retryLabel?: string;
  className?: string;
};

export function ErrorState({
  className = "",
  message,
  onRetry,
  retryLabel = "Try again",
  title,
}: ErrorStateProps) {
  return (
    <section className={className}>
      <Alert title={title} variant="error">
        <p>{message}</p>
        {onRetry ? (
          <Button className="mt-4" onClick={onRetry}>
            {retryLabel}
          </Button>
        ) : null}
      </Alert>
    </section>
  );
}
