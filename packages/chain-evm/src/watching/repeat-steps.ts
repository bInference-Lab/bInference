/**
 * Runs `step` again and again, each run once the one before settles, until a run answers
 * something other than `undefined`, which it then answers. The runs never chain up, however long
 * it goes on: no run waits on the next. Rejects with the first error a run rejects with, such as
 * its signal's reason once it aborts.
 */
export async function repeatSteps<T>(step: () => Promise<T | undefined>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const again = (): void => {
      step().then((outcome) => (outcome === undefined ? again() : resolve(outcome)), reject);
    };
    again();
  });
}
