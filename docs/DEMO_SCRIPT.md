# Three-Minute Demo Script

Target: 2 minutes 45 seconds. Record one clean local run. Use voice audio. No music.

## Capture Setup

Final recording uses a fresh local world and a real Standard-tier chapter request.

1. Stop every local app process.
2. Preserve any existing save with a recoverable move, for example `Move-Item data/ashen-crown.db data/ashen-crown.before-demo.db`. Include matching `-shm` and `-wal` files if present. Never overwrite a backup.
3. Run `npm run dev`, then open `http://localhost:3000` at a 1280 by 720 browser viewport.
4. Record a 1920 by 1080 canvas at 30 fps with an English microphone track. Hide notifications, `.env`, provider pages, and private account data.
5. Keep a terminal ready with completed `npm run evals` output for the terminal-guard segment. Do not show API keys or ignored reports.

Generation is variable. Start the final take only after one successful private rehearsal. If the real turn exceeds 60 seconds or fails, stop the take. Do not cut a failure into apparent success. Diagnose it, keep its trace, then record a new full take.

For no-cost layout rehearsal only, start from an empty `data/` directory and run `npm run demo:seed`. It restores the authenticated Rowan chapter-1 checkpoint from the registered local live report, verifies its report hash and trace, and makes no model request. It refuses to overwrite a save. This path rehearses Reader, God Mode, and evidence timing; it does not replace the real click-to-result segment in the final video.

## 0:00 to 0:18 — One Life

Show six-character selection.

Say:

> Infinite LitRPG is a local story engine where you choose one character and live only through that viewpoint. The other five keep pursuing their own goals. Canon stays deterministic, and the story must end by chapter 350.

Select Rowan. Show permanent viewpoint lock.

## 0:18 to 0:42 — Player Action

Choose the first suggested action.

Say:

> Player choices and custom actions become strict typed intents. Models never write world state. Application code validates the action before any canonical change.

## 0:42 to 1:08 — Living World

Open God Mode. Show up to three background intents and canonical resolution.

Say:

> GPT-5.6 Luna gives background characters bounded intent. One deterministic World Director resolves every intent, stages one WorldDelta, and remains the sole canon writer.

Point to accepted and rejected intents, world version, and accepted delta.

## 1:08 to 1:38 — Safe Chapter

Return to Reader. Show chapter prose and next choices.

Say:

> Luna writes only from Rowan's supplied knowledge. The draft is buffered, length-checked, audited for canon and hidden facts, then replayed as a stream. Rejected prose never reaches the reader.

## 1:38 to 2:04 — Trace and Cost

Open God Mode. Show model calls, prompt and schema versions, service tier, usage, cost, latency, state hashes, and audit.

Say:

> Every attempt keeps model, tier, tokens, cost, latency, response identity, state hashes, and validation result. Canon, chapter, knowledge, usage, and version commit atomically.

## 2:04 to 2:24 — Hard Limits

Show terminal test output or the submission evidence page.

Say:

> Offline evaluation runs one thousand resolved simulations, every act boundary, and the full chapter horizon. Chapter 350 becomes terminal. Chapter 351 is blocked before any model call.

## 2:24 to 2:45 — Codex Build Story

Show Git history, `docs/STATUS.md`, or test output.

Say:

> I built this with Codex and GPT-5.6. Codex drove source research, design concepts, strict TypeScript implementation, browser testing, security review, failure analysis, and regression-first fixes. Terra translates custom actions. Luna runs background intent, narration, bounded length recovery, and audit.

End on Reader plus title:

> Choose one life. The world keeps moving without you.

## Recording Checklist

- Keep final video below 2:55.
- Use English voice audio.
- Show no API key, `.env`, private account data, or provider dashboard.
- Use only original app visuals and spoken audio.
- Show real click-to-result behavior.
- Include Codex and GPT-5.6 use in spoken track.
- Upload as public YouTube video.
- Watch exported video once at normal speed before approval.
- Confirm the final take shows a real action click through committed Reader output.
