"use client";

import { useEffect, useState } from "react";
import type { BlogHeading } from "@/lib/blog";

/**
 * The rail at the middle right: a 2px scroll-progress track at rest, expanding
 * into the section list on hover. The active item is whichever heading last
 * crossed the reading line.
 */
export function BlogOutline({
  headings,
  label,
}: {
  headings: BlogHeading[];
  label: string;
}) {
  const [progress, setProgress] = useState(0);
  const [activeId, setActiveId] = useState(headings[0]?.id ?? "");

  useEffect(() => {
    if (headings.length === 0) return;

    let frame = 0;
    const measure = () => {
      frame = 0;
      const scrollable =
        document.documentElement.scrollHeight - window.innerHeight;
      setProgress(
        scrollable > 0 ? Math.min(1, Math.max(0, window.scrollY / scrollable)) : 0
      );

      const readingLine = window.scrollY + 140;
      let current = headings[0].id;
      for (const heading of headings) {
        const element = document.getElementById(heading.id);
        if (!element) continue;
        if (element.getBoundingClientRect().top + window.scrollY <= readingLine) {
          current = heading.id;
        }
      }
      setActiveId(current);
    };

    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(measure);
    };

    measure();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [headings]);

  if (headings.length === 0) return null;

  return (
    <nav className="blog-outline" aria-label={label}>
      <div className="blog-outline-track" aria-hidden="true">
        <div
          className="blog-outline-progress"
          style={{ height: `${Math.round(progress * 100)}%` }}
        />
      </div>
      <div className="blog-outline-panel">
        <ul className="blog-outline-list">
          {headings.map((heading) => (
            <li
              key={heading.id}
              data-level={heading.depth}
              className={heading.id === activeId ? "is-active" : undefined}
            >
              <a href={`#${heading.id}`}>
                <span>{heading.text}</span>
              </a>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
}
