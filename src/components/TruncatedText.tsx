import React from "react";

interface TruncatedTextProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** The full text to display and truncate if needed */
  text: string;
  /** Optional hard limit for character truncation */
  maxLength?: number;
  /** Custom CSS classes to apply to the span element */
  className?: string;
  /** Whether to show the full text as a tooltip on hover when truncated */
  useTooltip?: boolean;
}

/**
 * A highly customizable, accessible, and responsive component to handle text truncation.
 * Automatically adds a tooltip (via the browser's native `title` attribute) when the text is truncated
 * so that full details remain accessible to screen readers and mouse hover.
 */
export default function TruncatedText({
  text = "",
  maxLength,
  className = "",
  useTooltip = true,
  ...props
}: TruncatedTextProps) {
  const needsHardTruncation = maxLength !== undefined && text.length > maxLength;
  const displayText = needsHardTruncation ? `${text.substring(0, maxLength)}...` : text;

  // We should show the tooltip if hard-truncated or if the parent uses CSS truncation classes like `truncate` or `global-truncate`
  const showTooltip = useTooltip && (needsHardTruncation || className.includes("truncate") || className.includes("clamp") || className.includes("global-"));

  return (
    <span
      className={`inline-block max-w-full truncate align-bottom ${className}`}
      title={showTooltip ? text : undefined}
      {...props}
    >
      {displayText}
    </span>
  );
}
