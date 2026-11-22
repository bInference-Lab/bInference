"use client";

import { useEffect, useRef, useState } from "react";
import { Tally } from "../sections/tally";
import { HeaderMark } from "./header-mark";
import { activeChapter, type HeaderMode, type HeaderView, headerView } from "./header-state";
import styles from "./site-header.module.css";

interface Chapter {
  readonly href: string;
  readonly label: string;
}

/** The header's words and links. */
export interface SiteHeaderProps {
  readonly chapters: readonly Chapter[];
  readonly chaptersLabel: string;
  readonly start: string;
  readonly other: { readonly href: string; readonly label: string; readonly lang: string };
  readonly tally: { readonly taps: string; readonly moved: string };
}

interface Shape {
  readonly mode: HeaderMode;
  readonly hidden: boolean;
  readonly active: number;
  /** How many times the header changed shape; the mark's needle spins a half turn for each. */
  readonly turns: number;
}

interface Reading {
  readonly view: HeaderView;
  readonly active: number;
}

function readPage(
  chapters: readonly Chapter[],
  before: { readonly y: number; readonly hidden: boolean },
): Reading {
  const hero = document.getElementById("top");
  const view = headerView(
    {
      y: scrollY,
      heroEnd: hero?.offsetHeight ?? innerHeight,
      pageEnd: document.documentElement.scrollHeight - innerHeight,
    },
    before,
  );
  const tops = chapters.map(
    (chapter) => document.querySelector(chapter.href)?.getBoundingClientRect().top ?? Infinity,
  );
  return { view, active: activeChapter(tops, innerHeight * 0.45) };
}

function nextShape(now: Shape, reading: Reading): Shape {
  const { view, active } = reading;
  if (now.mode === view.mode && now.hidden === view.hidden && now.active === active) {
    return now;
  }
  return {
    mode: view.mode,
    hidden: view.hidden,
    active,
    turns: now.turns + (now.mode === view.mode ? 0 : 1),
  };
}

// One scroll listener reads the page once a frame: the header's shape goes to React, its progress
// straight to a CSS variable, so the hairline moves without a render.
function useHeaderShape(
  root: React.RefObject<HTMLElement | null>,
  chapters: readonly Chapter[],
): Shape {
  const [shape, setShape] = useState<Shape>({ mode: "top", hidden: false, active: -1, turns: 0 });
  useEffect(() => {
    let before = { y: scrollY, hidden: false };
    let queued = false;
    const read = (): void => {
      queued = false;
      const reading = readPage(chapters, before);
      before = { y: scrollY, hidden: reading.view.hidden };
      root.current?.style.setProperty("--progress", reading.view.progress.toFixed(4));
      setShape((now) => nextShape(now, reading));
    };
    const queue = (): void => {
      if (!queued) {
        queued = true;
        requestAnimationFrame(read);
      }
    };
    read();
    addEventListener("scroll", queue, { passive: true });
    addEventListener("resize", queue, { passive: true });
    return () => {
      removeEventListener("scroll", queue);
      removeEventListener("resize", queue);
    };
  }, [root, chapters]);
  return shape;
}

// The gold dot sits under the chapter the reader is in, and slides as the chapter changes.
function useChapterDot(nav: React.RefObject<HTMLElement | null>, active: number): void {
  useEffect(() => {
    const list = nav.current;
    if (list === null) {
      return;
    }
    const link = active < 0 ? undefined : list.querySelectorAll<HTMLElement>("a")[active];
    list.style.setProperty(
      "--dot-x",
      link === undefined ? "0px" : `${String(link.offsetLeft + link.offsetWidth / 2)}px`,
    );
    list.style.setProperty("--dot-on", link === undefined ? "0" : "1");
  }, [nav, active]);
}

/**
 * The header: open across the hero; past it, gathered into a floating capsule with the agent's
 * mark, the chapters with a gold dot under the one the reader is in, and a hairline that fills
 * with the reader's progress down the page.
 */
export function SiteHeader(props: SiteHeaderProps): React.JSX.Element {
  const root = useRef<HTMLElement>(null);
  const nav = useRef<HTMLElement>(null);
  const shape = useHeaderShape(root, props.chapters);
  useChapterDot(nav, shape.active);
  return (
    <header
      ref={root}
      className={[styles["header"], styles[shape.mode], shape.hidden ? styles["hidden"] : ""].join(
        " ",
      )}
    >
      <div className={styles["bar"]}>
        <a href="#top" className={styles["brand"]} aria-label="bInference">
          <HeaderMark turns={shape.turns} />
          <img className={styles["wordmark"]} src="/wordmark.svg" alt="" width={98} height={18} />
        </a>
        <div className={styles["tally"]}>
          <Tally words={props.tally} />
        </div>
        <nav ref={nav} className={styles["chapters"]} aria-label={props.chaptersLabel}>
          {props.chapters.map((chapter, index) => (
            <a
              key={chapter.href}
              href={chapter.href}
              aria-current={index === shape.active ? "location" : undefined}
            >
              {chapter.label}
            </a>
          ))}
          <i className={styles["dot"]} aria-hidden="true" />
        </nav>
        <div className={styles["end"]}>
          <a
            className={styles["language"]}
            href={props.other.href}
            hrefLang={props.other.lang}
            lang={props.other.lang}
          >
            {props.other.label}
          </a>
          <a className="btn btn-sm" href="#install">
            {props.start}
          </a>
        </div>
        <i className={styles["progress"]} aria-hidden="true" />
      </div>
    </header>
  );
}
