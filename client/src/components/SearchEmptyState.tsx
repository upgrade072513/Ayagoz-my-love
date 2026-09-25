import React from "react";

type SearchEmptyStateProps = {
  hasRows: boolean;
  hasMatches: boolean;
  emptyMessage: string;
  noMatchesMessage: string;
};

export function SearchEmptyState({ hasRows, hasMatches, emptyMessage, noMatchesMessage }: SearchEmptyStateProps) {
  if (hasRows && hasMatches) return null;
  return <div className="p-12 text-center text-slate-500">{hasRows ? noMatchesMessage : emptyMessage}</div>;
}
