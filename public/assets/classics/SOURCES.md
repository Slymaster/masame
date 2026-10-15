# Les Classiques: sources

Fifteen games of the Edo period (1603–1867), transcribed from public, freely accessible sources. No record comes from
GoGoD, Go4Go or any other commercial database. Only the moves, players, result and date are kept (moves are historical
facts); every commentary in the sources was left out, and the titles and context sentences are our own.

Conventions: main line only, no comments, `KM[0]` (no komi in the Edo period). `DT` is the first day of play converted to
the Gregorian calendar; when only the Japanese-calendar date is known to us it is reduced to the year (or month). Names
are the players' best-known names; ranks only where the source gives them.

## How each game was checked

- **Replay**: `src/classics/classics.test.ts` replays every move through the rules (no move on an occupied point, no
  suicide, no ko violation), checks the board size, the move count and the result against `index.json`.
- **Second source**: the main line was compared move by move with an independent public copy where one exists.
- **Position check**: for the two most famous games, the positions in Sensei's Library's diagrams were compared cell by
  cell with our record after the matching move.
- **Comparison only**: Andries Brouwer's public-domain archive (homepages.cwi.nl/~aeb/go/games) was used to compare
  moves and to read the Gregorian date of the first day of play. Brouwer notes that much of his old-game material
  probably derives from GoGoD (the files use GoGoD's date conventions), so nothing was copied from it and it is never
  the source of a shipped move.

Primary source "tasuki" = Vít Brunner's list of famous games, https://wiki.tasuki.org/games/go/famous (files at
https://github.com/tasuki/vitwiki/tree/master/games/go/famous).

## The games

| File | Game | Source of the moves | Cross-check |
|---|---|---|---|
| `dosaku-peichin-1682.sgf` | Honinbo Dosaku (W) – Peichin Hamahika (B, 4 stones), W+14 | tasuki `1682.sgf` | Same 241 moves and result as Brouwer `Dosaku/113.sgf` (comparison only). |
| `dosaku-shunchi-1684.sgf` | Honinbo Dosaku (W) – Yasui Shunchi (B, 2 stones), B+1 | tasuki `1683.sgf` (main line; its variations dropped) | Same 277 moves and result as Brouwer `Dosaku/122.sgf` (comparison only). Date 1684-01-05 (Japanese calendar Tenna 3, 11th month, 19th day). |
| `dochi-senkaku-1706.sgf` | Honinbo Dochi (B) – Yasui Senkaku (W), B+1, castle game | tasuki `1705.sgf` | Same 281 moves and result as Brouwer `ancient/Honinbo_Dochi/2.sgf` (comparison only). tasuki gives the Japanese date (1705, 11th month), which falls in January 1706. |
| `retsugen-senkaku-1792.sgf` | Honinbo Retsugen (B) – Yasui Senkaku (W), W+R | tasuki `1792.sgf` | **Single source.** Replay legal. Year only. |
| `chitoku-genjo-1812.sgf` | Yasui Chitoku (B) – Honinbo Genjo (W), B+R | tasuki `1812.sgf` (main line) | Same 155 moves and result as Brouwer `ancient/Honinbo_Genjo/1.sgf` (comparison only). |
| `rittetsu-jowa-1815.sgf` | Hattori Rittetsu, later Gennan Inseki (B) – Honinbo Jowa (W), B+4 | tasuki `1815.sgf` | Same 223 moves and result as Brouwer `ancient/Honinbo_Jowa/142.sgf` (comparison only). |
| `jowa-chitoku-1820.sgf` | Honinbo Jowa (B) – Yasui Chitoku (W), B+2 | tasuki `1820.sgf` (main line) | Same 259 moves and result as Brouwer `ancient/Honinbo_Jowa/192.sgf` (comparison only). |
| `blood-vomiting-1835.sgf` | Akaboshi Intetsu (B) – Honinbo Jowa (W), W+R | tasuki `1835.sgf` (main line) | **Cross-checked**: identical 246 moves in EidoGo's record https://github.com/jkk/eidogo/blob/master/sgf/blood_vomit.sgf, in maxiGos's sample https://github.com/parsimonhi/maxiGos/blob/master/_maxigos/_sample/_sgf/game/blood-vomit-en.sgf and in Little Go's https://github.com/herzbube/littlego/blob/master/sgf/Famous%20games/Blood-vomiting%20game.sgf. The seven full-board diagrams of https://senseis.xmp.net/?BloodVomitingGame match our positions after moves 33, 43, 53, 73, 83 and 246 exactly (the one after move 63 differs in two points). Date from the same page (13 August 1835). |
| `shintetsu-inseki-1835.sgf` | Yasui Shintetsu (B) – Inoue Inseki (W), W+7 | Arthur Smith, *The Game of Go* (1908), Illustrative Games, Plate 18, public domain: https://www.gutenberg.org/ebooks/66632 (game taken by Smith from Korschelt) | **Single source**, transcribed from the move list (letters A–T without I, rows counted from the bottom). All 256 moves legal; every move the book marks "Takes" captures, and every other capture is a move the book marks "Ko". "Played December, 1835". White, "Inouye Inseki", was then the head of the Inoue house, Gennan Inseki. |
| `shuwa-gennan-1842.sgf` | Honinbo Shuwa (B) – Inoue Gennan Inseki (W), B+6 | tasuki `1842.sgf` (main line) | **Cross-checked**: identical 270 moves in the sample game of the Perl module Games::Go::Sgf2Dg, https://github.com/gitpan/Games-Go-Sgf2Dg/blob/master/genan-shuwa.sgf. Brouwer `ancient/Honinbo_Shuwa/266.sgf` differs at move 253 only (H8 instead of H9 in our record); we keep the move the two other copies agree on. |
| `sanchi-shuwa-1844.sgf` | Yasui Sanchi (B) – Honinbo Shuwa (W), B+1, castle game | tasuki `1844.sgf` | **Single source.** Replay legal. Year only (Japanese calendar Koka 1, 11th month, 17th day). |
| `ear-reddening-1846.sgf` | Honinbo Shusaku (B) – Inoue Gennan Inseki (W), B+2 | tasuki `1846.sgf` | **Cross-checked**: identical 325 moves in Little Go's https://github.com/herzbube/littlego/blob/master/sgf/Famous%20games/Ear-reddening%20game.sgf (the same file as jgoboard's example) and in the Leela test record https://github.com/Sagebati/goban/blob/master/sgf/ShusakuvsInseki.sgf. The full-board diagram "The ear-reddening move" on https://senseis.xmp.net/?EarReddeningGame matches our position after move 127 exactly: Black 127 is at K11 (`ji`), next to the centre point. Result: tasuki says B+3; Little Go, the Leela record, Sensei's Library and Wikipedia (https://en.wikipedia.org/wiki/Ear-reddening_game) say two points, so we ship B+2. Date from Wikipedia (11 September 1846). |
| `shusaku-shuwa-1851.sgf` | Honinbo Shusaku (B) – Honinbo Shuwa (W), B+4 | tasuki `1851.sgf` | Same 227 moves and result as Brouwer `Shusaku/305.sgf`, board rotated 180° (comparison only). |
| `showa-shusaku-1851.sgf` | Ito Showa (B) – Honinbo Shusaku (W), W+R | tasuki `1852.sgf` | Same 154 moves and result as Brouwer `Shusaku/309.sgf` (comparison only). Began 1 December 1851. |
| `yuzo-shusaku-1853.sgf` | Ota Yuzo (B) – Honinbo Shusaku (W), W+3 | tasuki `1853.sgf` (main line) | Same 228 moves and result as Brouwer `Shusaku/342.sgf` (comparison only). |

## Left out, and why

- 1625, Yasui Santetsu – Nakamura Doseki (tasuki `1625.sgf`, from *Go World* no. 8): the source itself notes that
  another record has White 78 elsewhere, killing a black group. A doubtful record, so dropped.
- 1740, Cheng Lanru – Shi Xiangxia (tasuki `1740.sgf`): a Chinese game, not of the Edo period.
- 1839 Ito Showa – Yasui Sanchi and 1850 Shusaku – Ito Showa (Go Game Guru files shipped with gobandroid), the
  Shusaku – Gennan games of 1846 and 1855 in other GitHub repositories, and every game found only in Brouwer's archive:
  their headers use GoGoD's conventions (Japanese dates in `JD`/`GC`), so they were treated as GoGoD-derived.
- 1835, Yasui Shintetsu – Katsuda Eidzuke (Pfaundler, 1908, after Korschelt): Korschelt gave only 254 moves and the
  rest was invented by the author; the scanned table is also unreadable.
