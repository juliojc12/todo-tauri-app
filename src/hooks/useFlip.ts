import { useCallback, useLayoutEffect, useRef } from "react";

type Key = string | number;

const EASE = "cubic-bezier(.2, .8, .2, 1)";

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * FLIP list animation. Call `snapshot()` right before a state change that can move rows;
 * after React commits, every registered element slides from its old position to the new one,
 * and elements that did not exist before play an enter animation.
 */
export function useFlip(deps: unknown) {
  const els = useRef(new Map<Key, HTMLElement>());
  const before = useRef<Map<Key, DOMRect> | null>(null);
  // The first committed list is the initial load: rows appear without an enter animation.
  const primed = useRef(false);

  const register = useCallback(
    (key: Key) => (el: HTMLElement | null) => {
      if (el) els.current.set(key, el);
      else els.current.delete(key);
    },
    [],
  );

  const snapshot = useCallback(() => {
    const rects = new Map<Key, DOMRect>();
    els.current.forEach((el, key) => rects.set(key, el.getBoundingClientRect()));
    before.current = rects;
  }, []);

  /**
   * Plays an exit animation on a row and resolves when it has finished.
   * The returned function undoes it, for when the removal fails and the row stays.
   */
  const animateOut = useCallback(async (key: Key): Promise<() => void> => {
    const el = els.current.get(key);
    if (!el || reducedMotion()) return () => {};
    const anim = el.animate(
      [
        { opacity: 1, transform: "none" },
        { opacity: 0, transform: "translateX(28px)" },
      ],
      { duration: 220, easing: "ease-in", fill: "forwards" },
    );
    await anim.finished;
    return () => anim.cancel();
  }, []);

  useLayoutEffect(() => {
    const prev = before.current;
    before.current = null;
    if (!prev) return;
    if (!primed.current) {
      primed.current = true;
      return;
    }
    if (reducedMotion()) return;

    els.current.forEach((el, key) => {
      const old = prev.get(key);
      const now = el.getBoundingClientRect();
      if (old) {
        const dy = old.top - now.top;
        if (Math.abs(dy) > 1) {
          el.animate([{ transform: `translateY(${dy}px)` }, { transform: "none" }], {
            duration: 420,
            easing: EASE,
          });
        }
      } else {
        el.animate(
          [
            { opacity: 0, transform: "translateY(-6px)" },
            { opacity: 1, transform: "none" },
          ],
          { duration: 260, easing: EASE },
        );
      }
    });
  }, [deps]);

  return { register, snapshot, animateOut };
}
