import { Fragment, type ReactNode } from "react";

export function Prose({
  text,
  citations = {},
}: {
  text: string;
  citations?: Record<number, ReactNode>;
}) {
  return (
    <>
      {text
        .split(
          /(\[\d+\]|POST \/v1\/refunds|RefundService\.create|RefundPostingService|CreateRefundDto|operatorId|@acme\/fraud-check)/g,
        )
        .map((part, index) =>
          /^\[\d+\]$/.test(part) && citations[Number(part.slice(1, -1))] ? (
            <Fragment key={index}>
              {citations[Number(part.slice(1, -1))]}
            </Fragment>
          ) : /^(POST |RefundService|RefundPostingService|CreateRefundDto|operatorId|@acme)/.test(
              part,
            ) ? (
            <span key={index} className="font-mono text-[0.92em]">
              {part}
            </span>
          ) : (
            part
          ),
        )}
    </>
  );
}
