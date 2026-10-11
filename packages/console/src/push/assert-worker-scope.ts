/** An event whose handler hands the worker a promise to keep it alive until the work ends. */
interface WaitingEvent {
  waitUntil(work: Promise<void>): void;
}

/** A push event: its message's text, when it carries one. */
interface PushEventLike extends WaitingEvent {
  readonly data: { text(): string } | null;
}

/** A click on a notification the worker showed. */
interface NotificationClickLike extends WaitingEvent {
  readonly notification: { readonly tag: string; close(): void };
}

/** A page of this origin the worker can reach. */
export interface WindowClientLike {
  readonly url: string;
  focus(): Promise<object>;
  postMessage(message: { readonly type: "card"; readonly intent: string }): void;
}

/** What a notification shows; `renotify` alerts again for a tag already shown. */
export interface CardNotificationOptions extends NotificationOptions {
  readonly renotify?: boolean;
}

/** The parts of a service worker's global scope the push worker uses. */
export interface PushWorkerScope {
  addEventListener(type: "install" | "activate", listener: (event: WaitingEvent) => void): void;
  addEventListener(type: "push", listener: (event: PushEventLike) => void): void;
  addEventListener(
    type: "notificationclick",
    listener: (event: NotificationClickLike) => void,
  ): void;
  skipWaiting(): Promise<void>;
  readonly registration: {
    showNotification(title: string, options: CardNotificationOptions): Promise<void>;
  };
  readonly clients: {
    claim(): Promise<void>;
    matchAll(options: {
      readonly type: "window";
      readonly includeUncontrolled: boolean;
    }): Promise<readonly WindowClientLike[]>;
    openWindow(url: string): Promise<object | null>;
  };
}

/**
 * The global scope as the push worker's own: a service worker's, which the DOM types the console
 * compiles with do not describe.
 */
export function asWorkerScope(scope: typeof globalThis): PushWorkerScope {
  return scope as never;
}
