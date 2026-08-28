# How this page is built

`manager.html` is **generated**. Do not edit it — your changes will be
overwritten the next time anyone runs the build.

Edit the files under `js/`, then:

```
node build.js
```

which assembles them into `manager.html` between the `@modules-start` /
`@modules-end` markers.

## Why a build step at all

The page has to open by double-clicking. ES modules can't load over `file://`,
so the source is split into real files for editing and inlined into one page for
running. That is the whole reason this exists.

## What goes where

| File | Holds |
|---|---|
| `js/core.js` | Config, shared helpers, app state, derived lookups |
| `js/ca-overtime.js` | Which hours are premium. Pure, tested. |
| `js/ca-regular-rate.js` | What those hours cost. Pure, tested. |
| `js/caller-rotation.js` | Caller position rotation. Pure, tested. |
| `js/api.js` | **Every** Supabase call. The only file that knows the schema. |
| `js/views/*.js` | One file per tab. Return HTML strings; never fetch. |
| `js/app.js` | Render dispatch, event handlers, auth. |

The rule that matters: **views receive data, they never fetch it**, and nothing
outside `api.js` calls `sb.from(...)`. That is checked — `grep -c "sb.from(" js/views/*.js js/app.js`
should be zero everywhere.

## What the build checks

It refuses to write a broken page:

- every exported name from a module actually reached the page
- every `view*` function referenced is also defined (a patching mistake once
  deleted `viewStaff`, and it only surfaced as a blank screen at runtime)
- the assembled script parses

## Tests

```
npm test
```

44 tests, covering the overtime classification, the regular-rate maths, and the
caller rotation. The pure modules are the source of truth; the build only copies
them.
