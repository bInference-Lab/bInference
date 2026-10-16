import { useText } from "../i18n/console-text";
import { NoticeItem } from "./notice-item";
import { useNotices } from "./use-notices";

/**
 * The console's notice area: the owner's notices that arrive while the console is open, newest
 * first, each until the owner dismisses it. Screen readers hear each new one.
 */
export function NoticeArea(): React.JSX.Element {
  const text = useText();
  const { notices, dismiss } = useNotices();
  return (
    <section
      aria-label={text("console.notices.title")}
      className={notices.length === 0 ? "sr-only" : undefined}
    >
      <ul aria-live="polite" className="flex flex-col gap-2">
        {notices.map((notice) => (
          <NoticeItem key={notice.id} notice={notice} dismiss={() => dismiss(notice.id)} />
        ))}
      </ul>
    </section>
  );
}
