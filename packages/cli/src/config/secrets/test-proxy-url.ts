/**
 * A proxy address with a user and password in it, as an owner types one, for tests that plant a
 * password there and prove binference never shows it. The parts are joined as text, the way the
 * owner's input arrives.
 */
export function proxyUrlWith(user: string, password: string, hostPort: string): string {
  return "http://" + user + ":" + password + "@" + hostPort;
}
