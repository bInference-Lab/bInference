/** A CSS custom property name, such as `--p`. */
export type CssVariable = `--${string}`;

// The site's motion is driven by CSS custom properties (--p, --n, --i) set in `style`.
declare module "react" {
  interface CSSProperties {
    [property: CssVariable]: string | number;
  }
}
