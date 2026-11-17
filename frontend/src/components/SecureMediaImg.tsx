import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ImgHTMLAttributes,
  type SyntheticEvent,
} from "react";
import { refreshMediaToken, withFreshMediaToken } from "../api/scc";

type Props = Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "onError"> & {
  /** Stored `/uploads/...` path, absolute uploads URL, data:, or blob:. */
  src: string | null | undefined;
};

/**
 * <img> for authenticated /uploads attachments.
 * Keeps media_token fresh and auto-retries once/twice on load failure so
 * Replit users do not need a hard refresh when a token or storage blip occurs.
 */
export function SecureMediaImg({ src, alt = "", ...rest }: Props) {
  const attempts = useRef(0);
  const retrying = useRef(false);
  const [current, setCurrent] = useState<string | null>(() =>
    withFreshMediaToken(src),
  );

  const rebake = useCallback(
    (bust = false) => {
      const next = withFreshMediaToken(src, { bust });
      setCurrent(next);
      return next;
    },
    [src],
  );

  useEffect(() => {
    attempts.current = 0;
    retrying.current = false;
    rebake(false);
  }, [src, rebake]);

  useEffect(() => {
    const onMedia = () => {
      // New token minted (keepalive / focus) — restamp without burning retries.
      rebake(false);
    };
    window.addEventListener("scc-media-token", onMedia);
    return () => window.removeEventListener("scc-media-token", onMedia);
  }, [rebake]);

  async function onError(_event: SyntheticEvent<HTMLImageElement>) {
    if (!src || retrying.current || attempts.current >= 2) return;
    if (src.startsWith("data:") || src.startsWith("blob:")) return;
    retrying.current = true;
    attempts.current += 1;
    try {
      await refreshMediaToken();
      // Brief pause helps Replit object-storage transient misses.
      await new Promise((r) => window.setTimeout(r, 250 * attempts.current));
      rebake(true);
    } catch {
      /* leave broken after retries */
    } finally {
      retrying.current = false;
    }
  }

  if (!current) return null;
  return <img {...rest} src={current} alt={alt} onError={onError} />;
}
