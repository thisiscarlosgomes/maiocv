"use client";

import { useEffect, useState } from "react";

const OPTIONAL_PHOTO = /^\/placeholders\/.+\.(?:jpe?g|png|webp)$/i;

function optionalPhoto(src: string | null, fallback?: string | null) {
  return Boolean(src && fallback && src !== fallback && OPTIONAL_PHOTO.test(src));
}

/**
 * A stop photo that keeps the same box as a real picture.
 * A realistic placeholder that is not on disk yet is probed first and replaced
 * by the icon, so the card never paints a broken image.
 */
export function SafeImg({ src, fallback, alt, className, lazy }: {
  src: string | null;
  fallback?: string | null;
  alt: string;
  className?: string;
  lazy?: boolean;
}) {
  const [current, setCurrent] = useState<string | null>(optionalPhoto(src, fallback) ? fallback! : src);
  const [dead, setDead] = useState(false);

  useEffect(() => {
    setDead(false);
    if (!src) { setCurrent(null); return; }
    if (!optionalPhoto(src, fallback)) { setCurrent(src); return; }
    setCurrent(fallback ?? src);
    let cancel = false;
    const probe = new Image();
    probe.onload = () => { if (!cancel) setCurrent(src); };
    probe.onerror = () => { if (!cancel) setCurrent(fallback ?? null); };
    probe.src = src;
    return () => { cancel = true; };
  }, [src, fallback]);

  if (!current || dead) return <span className={className} role="img" aria-label={alt} />;
  return (
    <img
      className={className}
      src={current}
      alt={alt}
      loading={lazy ? "lazy" : undefined}
      onError={() => {
        if (fallback && current !== fallback) setCurrent(fallback);
        else setDead(true);
      }}
    />
  );
}
