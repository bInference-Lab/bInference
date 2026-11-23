import { type RefObject, useEffect } from "react";

// Watches the corner, and tells how many elements marked `data-agent-clear` are under it now.
function watchStepAside(corner: HTMLElement, onChange: (under: number) => void): () => void {
  const under = new Set<Element>();
  let watch: IntersectionObserver | undefined;
  const start = (): void => {
    watch?.disconnect();
    under.clear();
    const box = corner.getBoundingClientRect();
    // The root is shrunk to the corner's own box, with a little room around it.
    const margin = [
      box.top - 12,
      innerWidth - box.right - 12,
      innerHeight - box.bottom - 12,
      box.left - 12,
    ]
      .map((side) => `${String(-Math.max(0, Math.round(side)))}px`)
      .join(" ");
    watch = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            under.add(entry.target);
          } else {
            under.delete(entry.target);
          }
        }
        onChange(under.size);
      },
      { rootMargin: margin },
    );
    for (const clear of document.querySelectorAll("[data-agent-clear]")) {
      watch.observe(clear);
    }
  };
  start();
  addEventListener("resize", start, { passive: true });
  return () => {
    watch?.disconnect();
    removeEventListener("resize", start);
  };
}

/**
 * Lets the eyes step aside: while an element marked `data-agent-clear` passes under their
 * corner, the corner carries `asideClass`, so the eyes never cover what the reader needs.
 */
export function useStepAside(corner: RefObject<HTMLElement | null>, asideClass: string): void {
  useEffect(() => {
    const { current: element } = corner;
    if (element === null) {
      return undefined;
    }
    return watchStepAside(element, (under) => {
      element.classList.toggle(asideClass, under > 0);
    });
  }, [corner, asideClass]);
}
