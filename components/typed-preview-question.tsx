"use client";

import { useEffect, useRef, useState } from "react";

export function TypedPreviewQuestion({ text }: { text: string }) {
  const element = useRef<HTMLDivElement>(null);
  const [visibleCharacters, setVisibleCharacters] = useState(0);
  const characters = Array.from(text);

  useEffect(() => {
    const target = element.current;
    if (!target) return;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || !window.IntersectionObserver) {
      setVisibleCharacters(characters.length);
      return;
    }

    let timer: ReturnType<typeof setInterval> | undefined;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      observer.disconnect();
      timer = setInterval(() => {
        setVisibleCharacters((count) => {
          if (count + 1 >= characters.length) {
            clearInterval(timer);
            return characters.length;
          }
          return count + 1;
        });
      }, 45);
    }, { threshold: 0.35 });

    observer.observe(target);
    return () => {
      observer.disconnect();
      clearInterval(timer);
    };
  }, [text, characters.length]);

  return (
    <div ref={element} className="mini-question mini-question-typed">
      <span className="mini-question-reserve">{text}</span>
      <span className="mini-question-progress">
        {characters.slice(0, visibleCharacters).join("")}
        {visibleCharacters > 0 && visibleCharacters < characters.length && <span className="mini-question-caret" />}
      </span>
    </div>
  );
}
