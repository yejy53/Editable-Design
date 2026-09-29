"use client";

import { useEffect } from "react";

/**
 * Behaviour for the ```case gallery blocks in a rendered post. The markup comes
 * from the markdown pipeline as an HTML string, so this attaches to the DOM
 * instead of owning it; with the script absent the first entry stays visible.
 */
export function BlogGalleries() {
  useEffect(() => {
    const cleanups: Array<() => void> = [];

    const wireLoading = (frame: HTMLElement, video: HTMLVideoElement) => {
      const setLoading = (on: boolean) => {
        frame.dataset.loading = on ? "true" : "false";
      };

      const onWaiting = () => setLoading(true);
      const onReady = () => setLoading(false);

      setLoading(video.readyState < 3);
      video.addEventListener("loadstart", onWaiting);
      video.addEventListener("waiting", onWaiting);
      video.addEventListener("stalled", onWaiting);
      video.addEventListener("canplay", onReady);
      video.addEventListener("playing", onReady);
      video.addEventListener("loadeddata", onReady);

      cleanups.push(() => {
        video.removeEventListener("loadstart", onWaiting);
        video.removeEventListener("waiting", onWaiting);
        video.removeEventListener("stalled", onWaiting);
        video.removeEventListener("canplay", onReady);
        video.removeEventListener("playing", onReady);
        video.removeEventListener("loadeddata", onReady);
      });
    };

    const galleries = document.querySelectorAll<HTMLElement>(
      '.blog-case[data-mode="gallery"]'
    );

    for (const gallery of galleries) {
      const rail = gallery.querySelector<HTMLElement>(".blog-case-rail");
      const thumbs = Array.from(
        gallery.querySelectorAll<HTMLButtonElement>(".blog-case-thumb")
      );
      const panels = Array.from(
        gallery.querySelectorAll<HTMLElement>(".blog-case-panel")
      );
      const navs = Array.from(
        gallery.querySelectorAll<HTMLButtonElement>(".blog-case-rail-nav")
      );
      if (!rail || thumbs.length === 0) continue;

      gallery
        .querySelectorAll<HTMLElement>(".blog-case-stage-frame")
        .forEach((frame) => {
          const video = frame.querySelector("video");
          if (video) wireLoading(frame, video);
        });

      let active = 0;

      const select = (next: number, { scroll = true, focus = false } = {}) => {
        active = Math.min(thumbs.length - 1, Math.max(0, next));

        thumbs.forEach((thumb, index) => {
          thumb.setAttribute("aria-selected", String(index === active));
          thumb.tabIndex = index === active ? 0 : -1;
        });

        panels.forEach((panel, index) => {
          panel.hidden = index !== active;
          panel.querySelectorAll("video").forEach((video) => {
            const frame = video.closest<HTMLElement>(".blog-case-stage-frame");
            if (index === active) {
              if (frame) frame.dataset.loading = "true";
              video.currentTime = 0;
              void video.play().catch(() => {
                /* autoplay can still be blocked; controls remain */
              });
            } else {
              video.pause();
            }
          });
        });

        navs.forEach((nav) => {
          nav.disabled =
            nav.dataset.dir === "prev"
              ? active === 0
              : active === thumbs.length - 1;
        });

        const thumb = thumbs[active];
        if (scroll) {
          thumb?.scrollIntoView({
            behavior: "smooth",
            block: "nearest",
            inline: "nearest",
          });
        }
        if (focus) thumb?.focus();
      };

      thumbs.forEach((thumb, index) => {
        const handler = () => select(index);
        thumb.addEventListener("click", handler);
        cleanups.push(() => thumb.removeEventListener("click", handler));
      });

      navs.forEach((nav) => {
        const handler = () =>
          select(nav.dataset.dir === "prev" ? active - 1 : active + 1);
        nav.addEventListener("click", handler);
        cleanups.push(() => nav.removeEventListener("click", handler));
      });

      const onKeyDown = (event: KeyboardEvent) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        select(event.key === "ArrowLeft" ? active - 1 : active + 1, {
          focus: true,
        });
      };
      rail.addEventListener("keydown", onKeyDown);
      cleanups.push(() => rail.removeEventListener("keydown", onKeyDown));

      // Skip the scroll on the first pass, or a gallery further down the page
      // would pull the reader to it on load.
      select(0, { scroll: false });
    }

    return () => cleanups.forEach((cleanup) => cleanup());
  }, []);

  return null;
}
