/** Where a Postgres store connects, and as whom. A connection string is never read. */
export interface PostgresSettings {
  /** A host name or address, or the folder of a Unix socket (it starts with `/`). */
  readonly host: string;
  readonly port: number;
  readonly database: string;
  readonly user: string;
  readonly password?: string;
  /**
   * The PEM certificates of the server's CA. Every connection is TLS with the server's
   * certificate checked against them; only a loopback address or a Unix socket may leave them out.
   */
  readonly ca?: string;
  /** Names the service in `pg_stat_activity`, such as `binference-worker`. */
  readonly applicationName: string;
  /** The most connections the pool opens. */
  readonly maxConnections: number;
}
