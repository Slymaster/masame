# Les Classiques: sources

Twenty-one games of the Edo period (1603–1867), transcribed from public, freely accessible sources. No record comes from
GoGoD, Go4Go or any other commercial database. Only the moves, players, result and date are kept (moves are historical
facts); every commentary in the sources was left out, and the titles and context sentences are our own.

Conventions: main line only, no comments, `KM[0]` (no komi in the Edo period). `DT` is the first day of play in the
Gregorian calendar. Names are the players' best-known names; ranks only where the source gives them.

## Where the dates come from

No date is taken from a GoGoD-derived source. tasuki's files give the date in the Japanese lunisolar calendar (its `DT`
is the Japanese year, month and day, e.g. `1846-07-21` for Koka 3, 7th month, 21st day); we converted each one with the
National Astronomical Observatory of Japan's public calendar database (日本の暦日データベース,
https://eco.mtk.nao.ac.jp/cgi-bin/koyomi/caldb.cgi, "和暦から西暦へ変換", based on 内田正男『日本暦日原典』). Two checks
on the conversion: the two dates also printed in Gregorian by independent public sources come out identical (ear-reddening
game: 11 September 1846, Wikipedia; blood-vomiting game: 13 August 1835, Sensei's Library). Where a source gives no day,
or where the converted day disagrees with the other copies we compared, only the year is kept (`DT[1815]`).
Smith's book gives the month only (`DT[1835-12]`).

## How each game was checked

- **Replay**: `src/classics/classics.test.ts` replays every move through the rules (no move on an occupied point, no
  suicide, no ko violation), checks the board size, the move count and the result against `index.json`.
- **Second source**: the main line was compared move by move with an independent public copy where one exists.
- **Position check**: for the two most famous games, the positions in Sensei's Library's diagrams were compared cell by
  cell with our record after the matching move.
- **Comparison only**: Andries Brouwer's public-domain archive (homepages.cwi.nl/~aeb/go/games) was used to compare
  moves. Brouwer notes that much of his old-game material probably derives from GoGoD (the files use GoGoD's date
  conventions), so nothing was copied from it: it is the source of no shipped move and of no shipped date.

Primary source "Kogyoku yoin" = 石谷広策『敲玉余韻』 (Ishitani Kosaku, *Kogyoku yoin*, 1897, four volumes of Honinbo
Shusaku's games), public domain, scanned by the National Diet Library: volume 1 https://dl.ndl.go.jp/pid/861141, volume 3
https://dl.ndl.go.jp/pid/861143 (volume 2, pid 861142, is not online). Each game is printed as two full-board figures of
numbered stones (moves 1–100, then 101 to the end, numbered from 1 again), with recaptures listed above the board.

Primary source "tasuki" = Vít Brunner's list of famous games, https://wiki.tasuki.org/games/go/famous (files at
https://github.com/tasuki/vitwiki/tree/master/games/go/famous).

**Open point: tasuki's own origin is undocumented.** The page and the repository do not say where the SGF files come
from; the only licence statement is the wiki's cc by-sa footer. A GoGoD ancestry can therefore not be ruled out from the
documents alone. What argues against it: tasuki keeps the Japanese lunisolar dates (GoGoD converts to Gregorian), and
`retsugen-senkaku-1792` exists in no GoGoD-derived archive we checked. Settling it means asking Vít Brunner.

### How the Kogyoku yoin games were read

The six games added from *Kogyoku yoin* were read from the NDL's full-resolution images: the board grid of each figure
was located, every intersection was cut out and enlarged, and the numeral printed on each stone was read and checked
against a candidate move number; the stones without a number in the second figure were checked against the first
figure, and the moves listed above the board ("劫トル", "ツグ", "同") against the stones they replace. Andries Brouwer's
archive served only to propose the candidate number for each stone (comparison only, as above): wherever the book and
that archive disagree, the book's move is shipped and the disagreement is listed below. Dates come from the book's
headers (Japanese calendar), converted with the NAOJ database; where the book's day differs from Brouwer's, only the
year is kept. The replay test then checks every move for legality, and the result is the book's "中押勝" (win by
resignation) for Shusaku with Black in all six.

## The games

| File | Game | Source of the moves | Cross-check |
|---|---|---|---|
| `dosaku-peichin-1682.sgf` | Honinbo Dosaku (W) – Peichin Hamahika (B, 4 stones), W+14 | tasuki `1682.sgf` | Same 241 moves and result as Brouwer `Dosaku/113.sgf` (comparison only). Date: tasuki Tenna 2-04-17 → 1682-05-24. |
| `dosaku-shunchi-1684.sgf` | Honinbo Dosaku (W) – Yasui Shunchi (B, 2 stones), B+1 | tasuki `1683.sgf` (main line; its variations dropped) | Same 277 moves and result as Brouwer `Dosaku/122.sgf` (comparison only). Date: tasuki Tenna 3-11-19 → 1684-01-05. |
| `dochi-senkaku-1706.sgf` | Honinbo Dochi (B) – Yasui Senkaku (W), B+1, castle game | tasuki `1705.sgf` | Same 281 moves and result as Brouwer `ancient/Honinbo_Dochi/2.sgf` (comparison only). Date: tasuki Hoei 2-11-24 → 1706-01-08. |
| `retsugen-senkaku-1792.sgf` | Honinbo Retsugen (B) – Yasui Senkaku (W), W+R | tasuki `1792.sgf` | **Single source.** Replay legal. Date: tasuki Kansei 4-11-17 → 1792-12-30. |
| `chitoku-genjo-1812.sgf` | Yasui Chitoku (B) – Honinbo Genjo (W), B+R | tasuki `1812.sgf` (main line) | Same 155 moves and result as Brouwer `ancient/Honinbo_Genjo/1.sgf` (comparison only). Date: tasuki Bunka 9-04-02 → 1812-05-12. |
| `rittetsu-jowa-1815.sgf` | Hattori Rittetsu, later Gennan Inseki (B) – Honinbo Jowa (W), B+4 | tasuki `1815.sgf` | Same 223 moves and result as Brouwer `ancient/Honinbo_Jowa/142.sgf` (comparison only). tasuki gives the year only: year only. |
| `jowa-chitoku-1820.sgf` | Honinbo Jowa (B) – Yasui Chitoku (W), B+2 | tasuki `1820.sgf` (main line) | Same 259 moves and result as Brouwer `ancient/Honinbo_Jowa/192.sgf` (comparison only). tasuki's Bunsei 3-05-15 converts to 1820-06-25, which the other copy contradicts: year only. |
| `blood-vomiting-1835.sgf` | Akaboshi Intetsu (B) – Honinbo Jowa (W), W+R | tasuki `1835.sgf` (main line) | **Cross-checked**: identical 246 moves in EidoGo's record https://github.com/jkk/eidogo/blob/master/sgf/blood_vomit.sgf, in maxiGos's sample https://github.com/parsimonhi/maxiGos/blob/master/_maxigos/_sample/_sgf/game/blood-vomit-en.sgf and in Little Go's https://github.com/herzbube/littlego/blob/master/sgf/Famous%20games/Blood-vomiting%20game.sgf. The seven full-board diagrams of https://senseis.xmp.net/?BloodVomitingGame match our positions after moves 33, 43, 53, 73, 83 and 246 exactly (the one after move 63 differs in two points). Date from the same page (13 August 1835), also tasuki Tenpo 6-07-19 converted. |
| `shintetsu-inseki-1835.sgf` | Yasui Shintetsu (B) – Inoue Inseki (W), W+7 | Arthur Smith, *The Game of Go* (1908), Illustrative Games, Plate 18, public domain: https://www.gutenberg.org/ebooks/66632 (game taken by Smith from Korschelt) | **Single source**, transcribed from the move list (letters A–T without I, rows counted from the bottom). All 256 moves legal; every move the book marks "Takes" captures, and every other capture is a move the book marks "Ko". "Played December, 1835". White, "Inouye Inseki", was then the head of the Inoue house, Gennan Inseki. |
| `shuwa-gennan-1842.sgf` | Honinbo Shuwa (B) – Inoue Gennan Inseki (W), B+6 | tasuki `1842.sgf` (main line) | **Cross-checked**: identical 270 moves in the sample game of the Perl module Games::Go::Sgf2Dg, https://github.com/gitpan/Games-Go-Sgf2Dg/blob/master/genan-shuwa.sgf. Brouwer `ancient/Honinbo_Shuwa/266.sgf` differs at move 253 only (H8 instead of H9 in our record); we keep the move the two other copies agree on. Date: tasuki Tenpo 13-05-16 → 1842-06-24. |
| `sanchi-shuwa-1844.sgf` | Yasui Sanchi (B) – Honinbo Shuwa (W), B+1, castle game | tasuki `1844.sgf` | **Single source.** Replay legal. Date: tasuki 1844-11-17 (Tenpo 15, the year renamed Koka 1) → 1844-12-26. |
| `ear-reddening-1846.sgf` | Honinbo Shusaku (B) – Inoue Gennan Inseki (W), B+2 | tasuki `1846.sgf` | **Cross-checked**: identical 325 moves in Little Go's https://github.com/herzbube/littlego/blob/master/sgf/Famous%20games/Ear-reddening%20game.sgf (the same file as jgoboard's example) and in the Leela test record https://github.com/Sagebati/goban/blob/master/sgf/ShusakuvsInseki.sgf. The full-board diagram "The ear-reddening move" on https://senseis.xmp.net/?EarReddeningGame matches our position after move 127 exactly: Black 127 is at K11 (`ji`), next to the centre point. Result: tasuki says B+3; Little Go, the Leela record, Sensei's Library and Wikipedia (https://en.wikipedia.org/wiki/Ear-reddening_game) say two points, so we ship B+2. Date from Wikipedia (11 September 1846), also tasuki Koka 3-07-21 converted. |
| `shusaku-sanchi-1843.sgf` | Honinbo Shusaku (B) – Yasui Sanchi (W, 7 dan), B+R, at Akai Gorosaku's house | *Kogyoku yoin* vol. 1, frames 7–8 | **Cross-checked**: all 169 moves read in the book agree with Brouwer `Shusaku/061.sgf` (comparison only). Date: the book's Tenpo 14, 9th month, 5th day disagrees with Brouwer's 14th: year only. |
| `shusaku-saichiro-1844.sgf` | Honinbo Shusaku (B) – Kishimoto Saichiro (W), B+R | *Kogyoku yoin* vol. 1, frame 9 | **Cross-checked**: all 131 moves agree with Brouwer `Shusaku/076.sgf` (comparison only), including the four moves listed above the board. The book's second figure shows one black stone without a number (at G15) that no move accounts for; every numbered move agrees, so it is taken as a printing slip. Date: the book's Tenpo 14-12-11 → 1844-01-30. |
| `shusaku-gennan-1846.sgf` | Honinbo Shusaku (B) – Inoue Gennan Inseki (W), B+R, the game after the ear-reddening game | *Kogyoku yoin* vol. 3, frames 11–12 | **Cross-checked**: all 197 moves agree with Brouwer `Shusaku/128.sgf` (comparison only). The second figure shows two black stones without numbers (M12, O12) that no move accounts for. Date: the book says Koka 3, 7th month, 27th and 29th days; Brouwer gives the 29th and 30th: year only. |
| `shusaku-shuwa-1846.sgf` | Honinbo Shusaku (B) – Honinbo Shuwa (W, 8 dan), B+R, at the Honinbo house in Kurumazaka | *Kogyoku yoin* vol. 3, frame 24 | **Cross-checked with one difference**: moves 1–139 and 141 agree with Brouwer `Shusaku/135.sgf` (comparison only); White 140 is at F7 in the book and G6 in Brouwer: we ship the book's F7 (both are legal and the game ends at 141). The first figure also prints the number 77 on two stones (M14 and M13), a slip: White 106 is later shown at M14. Date: the book's Koka 3-10-21 → 1846-12-09 (Brouwer gives the same day). |
| `shusaku-saburosuke-1847.sgf` | Honinbo Shusaku (B) – Tsuruoka Saburosuke (W), B+R | *Kogyoku yoin* vol. 1, frames 23–24 | **Cross-checked**: all 157 moves agree with Brouwer `Shusaku/144.sgf` (comparison only). Date: the book says Koka 3, 12th month (no day), that is January–February 1847; Brouwer gives the 11th month: year only. |
| `shusaku-sanchi-1847.sgf` | Honinbo Shusaku (B) – Yasui Sanchi (W, 7 dan), B+R | *Kogyoku yoin* vol. 3, frames 12–13 | **Cross-checked with one difference**: all moves agree with Brouwer `Shusaku/158.sgf` (comparison only) except White 94, at E11 in the book and D10 in Brouwer; we ship the book's E11, which the book's second figure confirms. Date: the book's Koka 4-3-16 → 1847-04-30. |
| `shusaku-shuwa-1851.sgf` | Honinbo Shusaku (B) – Honinbo Shuwa (W), B+4 | tasuki `1851.sgf` | Same 227 moves and result as Brouwer `Shusaku/305.sgf`, board rotated 180° (comparison only). Date: tasuki Kaei 4-10-22 → 1851-11-15. |
| `showa-shusaku-1851.sgf` | Ito Showa (B) – Honinbo Shusaku (W), W+R | tasuki `1852.sgf` | Same 154 moves and result as Brouwer `Shusaku/309.sgf` (comparison only). Date: tasuki Kaei 4-11-09 → 1851-12-01. |
| `yuzo-shusaku-1853.sgf` | Ota Yuzo (B) – Honinbo Shusaku (W), W+3 | tasuki `1853.sgf` (main line) | Same 228 moves and result as Brouwer `Shusaku/342.sgf` (comparison only). Date: tasuki Kaei 6-06-05 → 1853-07-10. |

## Left out, and why

- 1625, Yasui Santetsu – Nakamura Doseki (tasuki `1625.sgf`, from *Go World* no. 8): the source itself notes that
  another record has White 78 elsewhere, killing a black group. A doubtful record, so dropped.
- 1740, Cheng Lanru – Shi Xiangxia (tasuki `1740.sgf`): a Chinese game, not of the Edo period.
- 1839 Ito Showa – Yasui Sanchi and 1850 Shusaku – Ito Showa (Go Game Guru files shipped with gobandroid), the
  Shusaku – Gennan games of 1846 and 1855 in other GitHub repositories, and every game found only in Brouwer's archive:
  their headers use GoGoD's conventions (Japanese dates in `JD`/`GC`), so they were treated as GoGoD-derived.
- 1835, Yasui Shintetsu – Katsuda Eidzuke (Pfaundler, 1908, after Korschelt): Korschelt gave only 254 moves and the
  rest was invented by the author; the scanned table is also unreadable.

## Twenty-one, and how the last six were found

The brief asks for about twenty games. We looked for more Edo games in public, non-commercial sources whose records do
not derive from GoGoD, and found none we could name and trust: tasuki's list is used in full (its two other pre-1868
files are dropped above, and 1582 is before the Edo period and doubtful); Smith (1908) has a single Edo game, used here;
the open-source viewers' samples (EidoGo, maxiGos, Little Go, jgoboard, Games::Go::Sgf2Dg, Sagebati/goban) repeat the games
already shipped; Sensei's Library shows partial diagrams only; the other copies on GitHub (gobandroid's, the "pgd" dumps
and the like) carry GoGoD's headers. Rather than pad the list with doubtful records, we first shipped fifteen. The six Shusaku games above were then read
from *Kogyoku yoin*, a public-domain book scanned by the National Diet Library. Three more games from the same volumes
were read and dropped: Shusaku – Ito Matsujiro 1844 (the book's second figure has no stone numbered 136, so the record
cannot be completed from the book), Takegawa Yasaburo – Shusaku 1847 (the number 65 is printed on two stones and the
last black move cannot be placed), and Shusaku – Shuwa, Koka 3-10-23 (the book's second figure departs from Brouwer's
record in several places and was not read in full). Also looked at without result: the Nihon Ki-in Go Hall of Fame pages
(biographies only, no game records), Wikimedia Commons (partial figures only, apart from the ear-reddening game),
kihuu.net (no stated source, Chinese-database names), and the samples of Sabaki, KaTrain, glift, besogo, EidoGo, maxiGos
and pachi (modern games or the games already shipped). Arthur Smith's book has no Edo game besides the 1835 one: its
other illustrative games are from 1906–1907 or Korschelt's Meiji games.
