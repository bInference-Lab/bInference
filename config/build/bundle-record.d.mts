/**
 * What the record reads of one file a build wrote: a chunk names the modules inside it, an asset
 * the source files it copies.
 */
interface WrittenFile {
  readonly type: "chunk" | "asset";
  readonly fileName: string;
  readonly name?: string;
  readonly isEntry?: boolean;
  readonly moduleIds?: readonly string[];
  readonly originalFileNames?: readonly string[];
}

/** The bundler plugin `bundleRecord` returns, in the shape tsdown and Vite both take. */
export interface BundleRecordPlugin {
  readonly name: string;
  buildStart(options: { readonly cwd?: string | undefined }): void;
  writeBundle(
    options: { readonly dir?: string | undefined },
    bundle: Readonly<Record<string, WrittenFile>>,
  ): void;
}

/** The folder beside `dist`, in each package, that holds each build's record. */
export declare const bundleRecordFolder: "bundle-record";

/**
 * A bundler plugin that records, once a build has written its files, the modules and copied files
 * of outside packages inside each file: `bundle-record/<first entry>.json` in the package's folder
 * holds `{ files: { "dist/<file>": ["<path from the package folder>", ...] } }`, a file with none
 * naming an empty list. The release reads these records to list and check the licenses each
 * tarball carries, so every build of a packed file must run it.
 */
export declare function bundleRecord(): BundleRecordPlugin;
