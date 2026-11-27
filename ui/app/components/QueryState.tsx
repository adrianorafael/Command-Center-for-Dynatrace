/** Loading / error / empty / content wrapper and the shared error and empty-state views. */
import React from "react";
import { Button } from "@dynatrace/strato-components/buttons";
import { MessageContainer, SkeletonText, EmptyState } from "@dynatrace/strato-components/content";
import { Flex } from "@dynatrace/strato-components/layouts";
import { errorMessage } from "./format";

/** Error banner: what happened (real error text) and what to do (Retry). */
export const ErrorMessage = ({
  title,
  error,
  onRetry,
}: {
  title: string;
  error: unknown;
  onRetry?: () => void;
}) => (
  <MessageContainer variant="critical">
    <MessageContainer.Title>{title}</MessageContainer.Title>
    <MessageContainer.Description>{errorMessage(error)}</MessageContainer.Description>
    {onRetry && (
      <MessageContainer.Actions>
        <Button onClick={onRetry}>Retry</Button>
      </MessageContainer.Actions>
    )}
  </MessageContainer>
);

/** One wrapper for the four states of a data view (DESIGN §14). */
export const QueryState = ({
  isLoading,
  error,
  isEmpty,
  empty,
  errorTitle = "Couldn't load data",
  onRetry,
  lines = 5,
  children,
}: {
  isLoading: boolean;
  error?: unknown;
  isEmpty?: boolean;
  empty?: React.ReactNode;
  errorTitle?: string;
  onRetry?: () => void;
  lines?: number;
  children: React.ReactNode;
}) => {
  if (error) return <ErrorMessage title={errorTitle} error={error} onRetry={onRetry} />;
  if (isLoading)
    return (
      <Flex flexDirection="column" gap={8} aria-busy="true">
        <SkeletonText lines={lines} />
      </Flex>
    );
  if (isEmpty) return <>{empty}</>;
  return <>{children}</>;
};

/** Strato empty state with a title and optional details and actions. */
export const SimpleEmpty = ({
  title,
  details,
  actions,
  size = "default",
}: {
  title: string;
  details?: React.ReactNode;
  actions?: React.ReactNode;
  size?: "small" | "default" | "large";
}) => (
  <EmptyState size={size}>
    <EmptyState.Title>{title}</EmptyState.Title>
    {details && <EmptyState.Details>{details}</EmptyState.Details>}
    {actions && <EmptyState.Actions>{actions}</EmptyState.Actions>}
  </EmptyState>
);
