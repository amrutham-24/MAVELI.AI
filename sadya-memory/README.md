# 🍃 Orma Sadhya — "See it. Remember it. Serve it."

A Kerala Onam Sadya memory game for WebXR (Meta Quest Browser), built with
[A-Frame](https://aframe.io). No build step — it's a static site.

## What's here

```
index.html        scene markup: leaf/table, target zones, world-space UI panels, player rig
js/game.js        all game logic (state machine, grab system, scoring, feedback, AI director)
assets/*.png      the 6 food items + banana leaf (resized from your originals for fast loading)
```

Everything runs client-side. There is no server, no build tool, no npm install.

## Run it

Any static file server works — WebXR just needs the page served over `http://localhost`
or `https://`. From this folder:

```
# Python (already on most machines)
python -m http.server 8080

# or Node, if you have it
npx serve .
```

Then open **http://localhost:8080** in a desktop browser to sanity-check the flow
without a headset (see "Desktop testing" below).

## Test on a Meta Quest

WebXR requires a *secure context*. `http://localhost` only works for a browser
running on the same machine — the Quest is a separate device, so it needs either:

- **Easiest: deploy it.** Push this folder to GitHub Pages, Netlify, Vercel, or
  any static host — they all give you a free `https://` URL. Open that URL in
  the Quest Browser and click **Enter VR**.
- **Quick local tunnel, no deploy.** Run the local server above, then tunnel it
  with `npx localtunnel --port 8080` or `cloudflared tunnel --url http://localhost:8080`,
  and open the resulting `https://` URL on the Quest.
- **Air Link / Link cable to a PC:** if you're running the site on the PC and
  viewing through Quest Link, the Quest's browser is *still a separate origin*
  in this setup — the tunnel/deploy approach above is the reliable path. (Link
  is for PCVR apps, not for the headset's own browser reaching a PC webpage.)

Once loaded in the Quest Browser, tap **Enter VR** (bottom-right of the A-Frame
canvas) to go immersive.

## Playing it

1. **START** — pinch it (hand tracking) or point the controller at it and pull
   the trigger, from within reach. On desktop, click it.
2. **Memorize** — 6 items sit on the banana leaf in their correct spots for
   ~8–10 seconds (shorter at higher difficulty). Countdown turns amber at 3s,
   red at 1s ("LAST LOOK!").
3. The reference arrangement fades away, and the real items scatter to
   reachable spots around you.
4. **Grab and place**: pinch/trigger-grab an item, move it over the leaf, let go.
   - Correct spot → green pulse, particle burst, "✓ CORRECT!", chime, item
     snaps into place and locks.
   - Wrong spot → red pulse, "✕ TRY AGAIN", soft buzz, item stays put and can
     be grabbed again.
5. All items placed → results panel with items/accuracy/time/mistakes/score,
   plus a short AI-director line, then **NEXT SADYA** to continue at an
   adjusted difficulty.

## Desktop testing (no headset)

- Mouse-look to aim the camera.
- **Mousedown** on an item picks it up and parks it in front of the camera —
  look toward the leaf, then **mouseup** to drop and validate. It's a stand-in
  for pinch/grab, not meant to feel like VR.
- Press **D** to toggle a debug panel (top-left): skip the memorize countdown,
  force-complete the round, jump to a difficulty level, or toggle visible
  rings over the target zones.

## Architecture notes

- **Interaction**: every hand entity carries `hand-tracking-controls`,
  `oculus-touch-controls`, and `generic-tracked-controller-controls`
  simultaneously — whichever input is actually active drives the entity, so
  hand-tracking and controllers work through the same code path with no
  branching. A custom `grab-hand` component listens for the union of
  `pinchstarted/ended`, `triggerdown/up`, and `gripdown/up` and does simple
  proximity-based grab (nearest `.grabbable` within ~16cm) rather than depending
  on a specific socket/snap component — easy to reason about and debug live.
- **Validation**: `OrmaSadhya.onRelease()` in `js/game.js` computes straight-line
  distance between the dropped item and its target zone; within the level's
  `radius` tolerance counts as correct. No pixel-perfect placement required.
- **Difficulty**: `LEVELS` array in `js/game.js` (item count, memorize time,
  tolerance radius, distractor count) — levels 1–3 ramp up to the full 6-item
  roster (salt, banana chips, sharkara varatti, payasam, rice, sambar);
  4–5 reuse all 6 at tighter tolerance/shorter memorize time.
- **AI director ("Gemma")**: `GemmaService.requestNextRound()` is a stub that
  always rejects — that's the wire-up point for a real endpoint (comment in
  the code shows the shape, e.g. a local Ollama `gemma2` call). Every call
  falls through to `FallbackGemmaService`, a deterministic local rule
  (>90% correct → harder, <60% → easier, else hold) so the game is always
  playable with zero network dependency, matching the spec's fallback
  requirement.
- **Audio**: every sound (grab, correct, incorrect, countdown tick/warning,
  fanfare) is synthesized at runtime via the Web Audio API — no sound asset
  files to source or license.

## Known trade-offs (given the "fast" build target)

- The memorize-phase reference photo (`assets/sadya.png`) still shows the
  original 7-item spread (it includes pappadam and a whole banana), but only
  6 items — salt, banana chips, sharkara varatti, payasam, rice, sambar — are
  actually placeable. Swap in a photo of just those 6 if that mismatch is
  confusing in practice.
- Source art was resized to 900px max dimension to keep first-load size
  reasonable on Quest's browser; re-run against the originals with a larger
  cap if you want higher fidelity and don't mind a slower first load.
- Rotation isn't scored — only position, per the spec's "position over
  rotation" priority. `LEVELS[].distractors` count is enforced; rotation
  tolerance isn't tracked since flat top-down placement makes it unnecessary
  for this MVP.
