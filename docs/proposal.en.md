# Masame (柾目) — proposal: the best Go software of 2026

*Written on 11 October 2026. It draws on five pieces of research checked against their sources: the market, joseki, real usage figures, aesthetics and Windows. It also draws on what we have built and measured: stages 0 and 1, and the 3D prototype. Version française : [proposition.md](proposition.md).*

*The project was called "Baduk" (working title) when this proposal was written; it is now called **Masame**.*

---

## In one sentence

**The first Go software that looks like a real goban and teaches like a real teacher.** It is a craftsman's object, rendered in real light. You play against an AI that behaves like a human of your own level, or online on OGS. A *play → understand → train* loop turns every game into progress. It runs on Mac and Windows, in French and English, offline if you wish, with no ads and no subscription.

---

## 1. What is really used in October 2026

### The numbers (collected on 11 October 2026)

The sources are the GitHub API, Google Play, the App Store, Similarweb, the OGS API and r/baduk. The Asian figures are self-reported and dated: treat them as orders of magnitude.

| Use | Who dominates | Key figures |
|---|---|---|
| Online play, China | **Fox Weiqi (野狐)** | 30M accounts and over 1M monthly actives (official 2022 figures), over 1,000 active pros, 20,000 to 40,000 players online at the same time (estimates) |
| Online play, Korea | Tygem | 3.8M members (2016), ≈ 10,000 online |
| Online play, West | **OGS** | 2.12M accounts (+640 per day), ≈ 29,600 games per day, 1.6M visits per month, 6% of them from France |
| AI analysis on desktop | KataGo, with KaTrain, Sabaki, LizzieYzy | Cumulative downloads: KataGo 1.06M, Sabaki 552k, KaTrain 289k. About 24,000 downloads per month in total, **65–90% on Windows versus 6–17% on Mac** |
| AI analysis on the web | AI Sensei | 133,000 visits per month |
| Mobile learning | BadukPop, Tsumego Pro | BadukPop: 2.17M Android installs, 36,400 iOS ratings (4.8★). Tsumego Pro: 2.13M installs |
| Problems on the web | 101weiqi | 583,000 visits per month |
| Steam | — | No real Go software has more than 16 reviews |

### What players really do

Sample: 400 OGS games drawn at random, from 4 to 11 October 2026.
- **92% of games are live, rapid or blitz**, averaging 10 minutes. 6% are played by correspondence.
- **47% on 19×19, 42% on 9×9**, 10% on 13×13.
- 34% of games involve a bot, and 24% of games between humans are played with a handicap.
- **75% of finished games receive an automatic KataGo review.** Only about 5% get a paid in-depth review.
- Uses ranked by the data: ranked online play, then AI review, daily tsumego (life-and-death problems), practice games against bots, and finally joseki (lots of questions, no tool really used).

### The six lessons that shape the plan

1. **Online play is use no. 1, and the community wants us to plug into OGS.** When a new server launched in October 2026, the most upvoted reply asked for it to *connect to OGS*. The OGS client therefore moves up the roadmap.
2. **9×9 weighs almost as much as 19×19.** "A 10-minute 9×9 against a human of your level" has to be a perfect moment.
3. **The "human" opponent is THE feature of 2024–2026.** The human network is KataGo's 4th most downloaded file (39,000 times). AI Sensei, BadukPop, SmartGo and KaTrain all sell a version of it. We need the best one.
4. **Basic AI review is already free everywhere.** What is missing:
   - the *why*;
   - **"guess, then reveal" (devine puis révèle)** analysis;
   - **two-player review** (absent from OGS).

   Strong players distrust explanations written by a language model. Ours will be **computed from engine data, and verifiable**.
5. **AI analysis on desktop means Windows** (65–90% of downloads). The Windows version is not optional.
6. **Tsumego is the daily habit, and the volume is on mobile.** Hence the daily ritual. A tablet and mobile version is worth considering later: Tauri 2 can do it.

---

## 2. The finding: each one excels at a single thing

| Need | Best today | Its limit |
|---|---|---|
| Playing online | Fox (Asia), OGS (West) | Dense or contested interfaces. OGS's September 2026 redesign triggered strong pushback. |
| Playing against a "human" AI | KaTrain 1.20, AI Sensei, BadukPop | Buried features, dull interface, web-based or subscription |
| AI review | OGS automatic review, AI Sensei, KaTrain | Win-rate curves, **no why**, no "guess, then reveal" and no two-player review |
| Tsumego | Tsumego Pro, 101weiqi, BadukPop | Generic banks, no explanation when you get it wrong, subscription |
| Joseki | OGS Joseki Explorer, Josekipedia, Joseki Dojo | Frozen trees or raw tools |
| Learning from your mistakes | GoReview (iOS, 2026) | iOS only |
| Beauty | SmartGo One (restraint), Sabaki (textures) | **No app looks high-end** |

**The gap in the market**: nobody brings beauty, a human-like AI, the why, personalised training and online play together in a single loop, on Mac *and* Windows.

---

## 3. The proposal: six pillars and a loop

```
   PLAY  ───────────►  UNDERSTAND  ───────────►  TRAIN
 (human-like AI, OGS,  (3 key moments,          (daily ritual:
  10-min 9×9)           guess, then reveal,      tsumego and joseki
        ▲               Light and Shadow)        drawn from YOUR games)
        └──────────────────────────────────────────────┘
```

1. **The object.** A craftsman's goban rendered in real light: the Living Atelier (Atelier vivant) (section 4).
2. **The human opponent.**
   - It plays like a player from 20k to 9d, with natural thinking times. While it thinks, you can hear it shuffling its stones in the bowl.
   - Automatic adjustment aims for a 50% win rate.
   - 10-minute 9×9 games.
   - The **Hall of Eras (salon des époques)** lets you play against the style of 1850, the 1930s or the pre-AlphaGo era.
3. **The teacher.**
   - **Each of your games is reviewed automatically on your machine**, including those played on OGS.
   - The review stops at **the 3 moments that decided the game**. For each, it shows what you played, what a player of your rank usually plays, and the best move.
   - **"Guess, then reveal"** mode has you propose your move before seeing the answer.
   - **Verifiable explanations** come from engine data. Example: "This move left the group at D4 without a base: −12 points".
   - You can **replay the moment** against the AI.
4. **Personal training**, as a **10-minute daily ritual**. It draws on:
   - **tsumego taken from your own games**, verified by KataGo;
   - your joseki deviations;
   - the **joseki dojo**: rank lens, punishing the mistake, choosing the right joseki for the whole board.

   All of it is revised with spaced repetition (FSRS-style).
5. **Plugged into the world.**
   - **The most beautiful OGS client**: live ranked play, import of your games by username, automatic local review.
   - SGF import (Fox, KGS, Tygem).
   - Later: two-player review and a photo of a real goban.
6. **Everywhere and honest.**
   - Mac and Windows, French and English.
   - Offline for the AI, private data.
   - Free, open source recommended.
   - KataGo credited, networks kept up to date from the official catalogue.

---

## 4. Aesthetics pushed to the maximum: the "Living Atelier"

The first prototype was a local file (`design/atelier3d/`, not in the repository), now superseded by the renderer in `src/board3d/`.

### What is already demonstrated
- **The true proportions** of a goban:
  - cells of 22 × 23.7 mm, so longer than wide;
  - 1 mm lines in lacquer ink, 4 mm hoshi (star points);
  - a 424 × 454 mm board, domed stones of 22.2 mm (black) and 21.9 mm (white).

  No app respects these proportions.
- **The materials.**
  - Black stones are satin slate with a micro-roughness, not shiny plastic.
  - White stones are shell with growth striations, each one different.
  - Each stone is slightly offset, as if placed by hand, and neighbouring stones push each other apart without overlapping.
- **The light**: real interior lighting (a CC0-licensed HDRI) and a main light that follows the time of day: morning at 5,500 K, afternoon at 4,200 K, evening at 3,000 K.
- **Two cameras.**
  - **Study**: a sharp orthogonal top-down view with no distracting reflections. This is the play and analysis mode.
  - **Contemplation**: a 28° lens, board tilted by 22° (with the 22 × 23.7 mm cells, they then appear square). You can see the thickness of the board and the mulberry bowls, and captured stones pile up on the lids.
- **"Light and Shadow" (Ombre et lumière) becomes real light.** The territory estimate is projected as a light source: White's territory receives a warm light, Black's falls into shadow, on the wood as on the stones. **No Go app does this.**
- **Placement**: the stone drops 12 mm in 140 ms, its shadow tightens, a 0.4° tremor follows, and neighbouring stones shift by half a millimetre.
- **Measured performance** (M2 Max, 2880 × 1800): 3.1 ms per frame in Study, 4.9 ms in Contemplation. Rendering only runs when something moves.

### What remains to reach the maximum
| Detail | Impact | Effort |
|---|---|---|
| **Recorded sounds**: variants by strength, neighbouring stones, a capture that clacks onto the lid, room reverb, stones shuffled in the bowl while the AI thinks | Very high (done: recorded CC0 sounds) | Low to medium |
| **Real kaya wood**: a scanned texture with visible fibres. Now real scanned wood (ambientCG) graded to golden kaya; remaining: a higher-resolution scan for macro close-ups. | Very high (done, except the high-resolution scan) | Low |
| Finer translucency and striations in the shell | High | Medium |
| Mac trackpad haptic feedback on captures and at the end of the game | Medium | Low |
| Light that follows the real time of day (option) | Medium | Low |
| **Old-school end of game**: when counting, territories rearrange into rectangles, as players do | High (signature moment) | Medium |
| **Light 2D mode**: the current Canvas rendering, kept as a fallback for small graphics cards | Essential | Already done |

### Legibility safeguards
- In Study, white stones keep a contrast of at least 3:1 against the wood (measured: 3.2 to 3.7 depending on the time of day).
- Effects are switched off during analysis.
- Animations are disabled if the system requests reduced motion.
- A "high-contrast stones" option is planned.
- The 9×9 gets its own care: the stones are large there, and every detail shows.

---

## 5. What this beats, feature by feature

| Feature | Best existing | Our version |
|---|---|---|
| Human-like bot | KaTrain Human-like (hidden menu), BadukPop | Rank from 20k to 9d showcased, eras, human tempo, adjustment towards a 50% win rate |
| Review | OGS automatic review, AI Sensei | 3 key moments, guess then reveal, rank lens, verifiable explanations, replay the moment, all your games reviewed on your machine |
| Territory | Coloured squares | Light and Shadow, in real light |
| Online play | OGS website | OGS client in the Atelier, automatic review included |
| Tsumego | Generic banks | Drawn from **your** games, verified by KataGo, plus classic banks |
| Joseki | Frozen trees | AI-era tree generated by us, statistics by rank, move-by-move spaced repetition, punishment, whole-board context |
| AI networks | Configure them yourself | x; automatic choice according to the machine is planned (Engine tuning) |
| Counting | Often approximate | Dead stones suggested, one click to correct, Japanese scoring *(already done)* |
| Beauty | Flat wood | Living Atelier |
| Platforms | Often just one | Mac and Windows, French and English |

---

## 6. Mac and Windows: the architecture

A single codebase: Tauri 2 (Rust), React/TypeScript and three.js.

### The KataGo engine
| | Mac | Windows |
|---|---|---|
| Version | 1.18.2, **compiled by us with Metal** (no official Mac build) | 1.18.1 official |
| Shipped with the app | The Metal binary (≈ 11 MB) | The OpenCL (6 MB) and CPU AVX2 (5.9 MB) builds, `OpenCL.dll` comes from the GPU driver; if it is missing, the app falls back to the CPU engine automatically |
| Downloaded on demand | — | **OpenVINO** for Intel chips (up to 20 times faster than OpenCL on Arc), **DirectML** as a last resort, **CUDA** only if the NVIDIA libraries are already present (otherwise 1.5 to 2 GB) |
| Detection | — | List of graphics cards via DXGI (NVIDIA, AMD, Intel, video memory), automatic test and one-level fallback on failure |
| Security | KataGo source pinned by commit, dependencies by sha256. Signed with a Developer ID and notarised by Apple since v0.2.1. | Official archives pinned by sha256 **in the build script**, extraction protected against booby-trapped paths, `%LOCALAPPDATA%` folder, process bound to the app (it stops with it). Signing planned. |

- **First launch, "Engine tuning" (Accordage du moteur).** The app measures the machine's real speed, tunes OpenCL and picks the default network (Light, Balanced or Maximum). Transformer networks are slow on Mac (≈ 130 positions/s for Balanced), and the variety of Windows graphics cards is huge: so we must measure, not guess.
- **Mac engine**: self-contained (protobuf and abseil linked statically), macOS 13 or later, Apple Silicon. The KataGo source is pinned by commit.

### Window and rendering
- **Mac**: integrated title bar, inset traffic-light buttons.
- **Windows**: native bar and the Windows 11 Mica effect. This keeps tiled window layouts (Snap), which a custom bar would lose.
- **Rendering**: WebGL2 everywhere. WebGPU is available on macOS 26 and on most Windows PCs, but it is not essential.
- **Small graphics cards**: a governor adjusts resolution, shadows and anti-aliasing, then switches to light 2D mode if needed. Windows often uses the integrated graphics chip, so this case must be planned for.

### Build
- GitHub Actions (`tauri-action` v1) on Mac and Windows machines, NSIS installer in French and English. Signed automatic updates are in place since v0.2.0.
- Building for Windows from a Mac is possible, but only as a last resort.

---

## 7. French and English

- All texts are already centralised (`src/i18n/en.ts` and `src/i18n/fr.ts`), and the Rust side only returns codes.
- Two typed dictionaries, `fr` and `en`: an incomplete dictionary does not compile. No heavy library.
- The language is detected from `navigator.language`, with a manual choice in the settings.
- The native menus, dialog boxes, installer and documentation exist in both languages.
- Go vocabulary stays that of the community: kyu, dan, joseki, tsumego, sente, gote.
- France matters: 6% of OGS visits, the 4th iOS market for SmartGo One and Tsumego Pro.

---

## 8. Distribution, signing, open source

- **Mac.** The Apple Developer programme ($99/year) is needed for the app to open without a warning.
- **Windows.** EV certificates no longer bypass SmartScreen. Three options:
  1. **Open source and SignPath Foundation** (free for projects under a free licence). *Recommended.*
  2. Azure Artifact Signing (€8.79/month). It is reserved for organisations in the EU: an individual in France cannot access it.
  3. An OV certificate on an online HSM (price not verified).
- **Open source (MIT licence, like KaTrain and Sabaki), recommended.** It shows the care taken and builds trust. It also opens the door to free Windows signing and to contributions.

---

## 9. Roadmap, prioritised by real usage

| Phase | Content | Why now | Status |
|---|---|---|---|
| **0. The touch** | 2D Atelier goban, rules, SGF | — | ✅ done |
| **1. The opponent** | KataGo Metal, network manager, human-like bot, territory, counting | — | ✅ done, verified, security reviewed |
| **A. Foundations** | French/English, Windows version (engines, detection, CI), standalone Mac engine, open source | Windows = 65–90% of AI-tool users | Mostly done: French/English done; self-contained Mac engine done; Windows support written and built in CI, not yet tested on Windows hardware; open-source preparation done, publication pending |
| **B. Living Atelier** | 3D rendering in the app, two cameras, light, recorded sounds, haptics, polished 9×9, 2D fallback | The signature that looks like nothing that exists | In progress: 3D renderer integrated as the main board with 2D fallback; real CC0 wood and recorded stone sounds done. Remaining: haptics, old-school end of game, real-time-of-day light option |
| **C. The teacher** | Automatic local review, 3 key moments, guess then reveal, rank lens, verifiable explanations, replay the moment | The 2nd use, and the "why" is missing everywhere | |
| **D. The world** | OGS client (live ranked play, import by username, review of your OGS games) | Use no. 1, and the community's explicit request | |
| **E. Training** | Daily ritual: tsumego drawn from your games, joseki dojo, spaced repetition | Tsumego is the daily habit; joseki is your starting wish | |
| **F. Eras and sharing** | Hall of Eras, two-player review, photo of a real goban, tablet version | Long-term differentiation | |

*The joseki dojo (E) can be moved ahead of the OGS client (D) if learning joseki remains your personal priority.*

---

## 10. Decisions to make

1. **Validate the "Living Atelier" 3D direction** as the main rendering, with 2D serving as the light mode.
2. **Authorise the following downloads**:
   - protobuf 29.3 and abseil 20240722 sources (standalone Mac engine);
   - official KataGo engines for Windows (OpenCL and AVX2, ≈ 12 MB);
   - higher-quality wood textures (CC0);
   - recorded stone sounds, CC0, from Freesound. *Or better: if you have a goban, record your own stones.*
3. **Open source or private**, with its consequences for Windows signing.
4. **Windows testing**: a Windows PC, a virtual machine, or only CI with testers.
5. *(Later)* the Apple Developer account and the order of phases D and E.

**Chosen name**: *Masame* (柾目). It is the straight grain of the finest kaya goban: a word that connoisseurs recognise, easy to search for, and consistent with the Atelier. Other leads considered: *Komorebi* (木漏れ日, the light filtered through foliage, echoing "Light and Shadow") or *Goishi* (碁石, Go stones). Trademark availability to be checked.

---

## 11. Risks

- **Transformer networks are slow on Metal**: the engine recompiles the network for each batch size, and the first 5 to 8 requests stay slow despite warm-up.
  - Mitigations: fixed batches, measurement on first launch, Light network on small machines.
  - Lead: contribute the fix to KataGo.
- **The Windows fleet is very heterogeneous**: temperamental Intel and older AMD OpenCL drivers, Windows 10's DirectML crashing, antivirus software wary of an unsigned `katago.exe`.
  - Mitigations: automatic test, fallback chain, signing.
- **3D on an integrated graphics card** has only been measured on Apple Silicon. Mitigations: governor and 2D mode.
- **OGS**: a third-party client subject to their terms of use, with login through an OGS account. To be validated before phase D.
- **Licences.**
  - KataGo is under MIT, the networks under an MIT-style licence.
  - **The human network's licence is confirmed**: the official page (katagotraining.org/network_license, read 11 October 2026) explicitly names the "KataGo Human SL Network". We still have it downloaded from the official source.
  - The catalogue's "zhizi" networks carry their own MIT-style licence, to be credited if one becomes "strongest right now".
  - Assets are CC0 and fonts are under the OFL licence.
- **Competition**, which moves fast: Hoshi (beta, OGS client, joseki trainer), Kaya (8 languages, KataGo in the browser), GoReview, Joseki Dojo, KaTrain. Chess.com has named Go among its upcoming games, with no date. None combines the six pillars, but we need to move forward.

---

## Sources

The details and links are in `docs/exploration.md`, `docs/katago-benchmark.md` and the research reports. The main ones:
- Usage: GitHub API (`api.github.com/repos/…/releases`), Google Play, App Store (`itunes.apple.com/lookup`), Similarweb (September 2026), OGS API (`online-go.com/api/v1/…`), r/baduk. Fox: https://www.foxwq.com/news/13872.html · GoMagic: https://gomagic.org/play-go-online/
- KataGo (versions and networks): https://github.com/lightvector/KataGo/releases · https://katagotraining.org/networks/
- KaTrain: https://github.com/sanderland/katrain · Sabaki: https://github.com/SabakiHQ/Sabaki · Kaya: https://github.com/kaya-go/kaya · Joseki Dojo: https://github.com/EternalEclipse999/joseki-dojo
- Tauri (sidecar, Windows): https://v2.tauri.app/ · tauri-action: https://github.com/tauri-apps/tauri-action
- Poly Haven (CC0): https://polyhaven.com/license · Freesound (CC0): https://freesound.org/people/billhails2/sounds/588317/
- Equipment dimensions: https://en.wikipedia.org/wiki/Go_equipment · https://senseis.xmp.net/?GoBoard
- Windows signing: Azure Artifact Signing · SignPath Foundation (https://signpath.org/)
