/* A scratch copy of the built pages for the browser checks to load.
   It used to be made by hand, went stale, and a run passed against the
   previous manager.html -- so both tools rebuild it now, every run. */
import { mkdirSync, readdirSync, copyFileSync, rmSync } from 'node:fs';
export const NAKED = '/tmp/naked';
export function freshNaked() {
  rmSync(NAKED, { recursive: true, force: true });
  mkdirSync(NAKED, { recursive: true });
  for (const f of readdirSync('sched').filter(f => f.endsWith('.html')))
    copyFileSync(`sched/${f}`, `${NAKED}/${f}`);
  return NAKED;
}
