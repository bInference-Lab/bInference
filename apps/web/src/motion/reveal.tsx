"use client";

import { type ElementType, type ReactNode, useCallback } from "react";

/** The elements a reveal can be. */
type RevealTag = "div" | "p" | "h1" | "h2" | "span";

/** Props of a reveal: a block that rises into place the first time it comes into view. */
export interface RevealProps {
  readonly tag?: RevealTag;
  readonly className?: string | undefined;
  /** Its place in a staggered group: each step waits 90 ms more. */
  readonly order?: number;
  /** Split headings set this: only their words move, the block itself stays put. */
  readonly wordsOnly?: boolean;
  readonly children: ReactNode;
}

let observer: IntersectionObserver | undefined;

function shared(): IntersectionObserver {
  observer ??= new IntersectionObserver(
    (records, self) => {
      for (const record of records) {
        if (record.isIntersecting) {
          record.target.classList.add("in");
          self.unobserve(record.target);
        }
      }
    },
    { threshold: 0.18, rootMargin: "0px 0px -8% 0px" },
  );
  return observer;
}

/** A block that rises into place once, as it first comes into view. */
export function Reveal(props: RevealProps): React.JSX.Element {
  const watch = useCallback((node: HTMLElement | null) => {
    if (node === null) {
      return undefined;
    }
    const watcher = shared();
    watcher.observe(node);
    return () => watcher.unobserve(node);
  }, []);
  const Tag: ElementType = props.tag ?? "div";
  const base = props.wordsOnly === true ? "" : "reveal";
  return (
    <Tag
      ref={watch}
      className={[base, props.className].filter(Boolean).join(" ")}
      style={props.order === undefined ? undefined : { "--i": props.order }}
    >
      {props.children}
    </Tag>
  );
}
