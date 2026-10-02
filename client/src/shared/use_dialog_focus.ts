import { useEffect, useRef } from "react";

const focusable_selector = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

interface dialog_focus_options {
  on_escape?: (() => void) | undefined;
  initial_focus?: string | undefined;
}

export function use_dialog_focus<T extends HTMLElement>(
  options: dialog_focus_options = {},
) {
  const container_ref = useRef<T>(null);
  const options_ref = useRef(options);

  useEffect(() => {
    options_ref.current = options;
  });

  useEffect(() => {
    const container = container_ref.current;
    if (!container) return;

    const previous = document.activeElement as HTMLElement | null;
    const selector = options_ref.current.initial_focus;
    const initial = selector
      ? container.querySelector<HTMLElement>(selector)
      : null;
    (initial ?? container).focus();

    const get_focusable = () =>
      Array.from(
        container.querySelectorAll<HTMLElement>(focusable_selector),
      ).filter((element) => element.getClientRects().length > 0);

    const on_key_down = (event: KeyboardEvent) => {
      const on_escape = options_ref.current.on_escape;
      if (event.key === "Escape" && on_escape) {
        event.preventDefault();
        on_escape();
        return;
      }
      if (event.key !== "Tab") return;

      const items = get_focusable();
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) {
        event.preventDefault();
        container.focus();
        return;
      }
      const active = document.activeElement;
      if (!container.contains(active)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && (active === first || active === container)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", on_key_down);
    return () => {
      document.removeEventListener("keydown", on_key_down);
      if (previous && document.contains(previous)) previous.focus();
    };
  }, []);

  return container_ref;
}
