/**
 * @module commands/hello
 * `abq-media hello [--name <name>]` — Prints a greeting.
 *
 * Learning exercise: demonstrates the command registration pattern.
 */

function arg(flag: string, fallback = ''): string {
  const i = process.argv.indexOf(flag);
  return i === -1 ? fallback : (process.argv[i + 1] || fallback);
}

export async function cmdHello(): Promise<void> {
  const name = arg('--name', 'World');
  console.log(`Hello, ${name}!`);
}
