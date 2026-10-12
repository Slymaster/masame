import GoBoard, { type Sign, type Vertex } from '@sabaki/go-board'

export type { Sign, Vertex }
/** vertex === null is a pass. */
export interface Move { sign: Sign; vertex: Vertex | null }

export interface GameInfo {
  size: number
  komi: number
  playerBlack: string
  playerWhite: string
  setup: { black: Vertex[]; white: Vertex[] }
  /** Who moves first when there is no move yet (handicap / setup positions). */
  firstSign: Sign
  /** SGF RE value once the game is decided ("W+4.5", "B+R", "0"). */
  result?: string
}

export type PlayResult = 'ok' | 'occupied' | 'suicide' | 'ko' | 'ended'

const RULE_ERRORS: Record<string, PlayResult> = {
  'Overwrite prevented': 'occupied',
  'Suicide prevented': 'suicide',
  'Ko prevented': 'ko',
}

/** Same stones and captures but a fresh board: unlike clone(), it drops the ko ban, which a pass lifts. */
function passBoard(b: GoBoard): GoBoard {
  return new GoBoard(b.signMap.map(row => [...row])).setCaptures(1, b.getCaptures(1)).setCaptures(-1, b.getCaptures(-1))
}

/**
 * Linear game record: `boards[i]` is the position after `moves[0..i)`; `cursor` is the displayed position.
 * shortcut: a single main line — playing from history discards the later moves; upgrade to a tree when variations arrive.
 */
export class Game {
  readonly info: GameInfo
  moves: Move[] = []
  boards: GoBoard[]
  cursor = 0

  constructor(info: Partial<GameInfo> & { size: number }) {
    this.info = {
      komi: 6.5, playerBlack: '', playerWhite: '', setup: { black: [], white: [] }, firstSign: 1,
      ...info,
    }
    let board = GoBoard.fromDimensions(this.info.size)
    for (const v of this.info.setup.black) board = board.set(v, 1)
    for (const v of this.info.setup.white) board = board.set(v, -1)
    this.boards = [board]
  }

  get board(): GoBoard { return this.boards[this.cursor] }
  get lastMove(): Move | null { return this.moves[this.cursor - 1] ?? null }
  get toPlay(): Sign { return this.lastMove ? (-this.lastMove.sign as Sign) : this.info.firstSign }
  get ended(): boolean {
    const a = this.moves[this.cursor - 1], b = this.moves[this.cursor - 2]
    return !!a && !!b && !a.vertex && !b.vertex
  }

  play(vertex: Vertex | null): PlayResult {
    if (this.ended) return 'ended'
    const sign = this.toPlay
    let next: GoBoard
    if (vertex) {
      try {
        next = this.board.makeMove(sign, vertex, { preventOverwrite: true, preventSuicide: true, preventKo: true })
      } catch (e) {
        const r = RULE_ERRORS[(e as Error).message]
        if (r) return r
        throw e
      }
    } else {
      next = passBoard(this.board)
    }
    this.moves.length = this.cursor
    this.boards.length = this.cursor + 1
    this.moves.push({ sign, vertex })
    this.boards.push(next)
    this.cursor++
    this.info.result = undefined // the record changed: a loaded or validated result no longer describes it
    return 'ok'
  }

  isLegal(vertex: Vertex): boolean {
    try {
      this.board.makeMove(this.toPlay, vertex, { preventOverwrite: true, preventSuicide: true, preventKo: true })
      return true
    } catch {
      return false
    }
  }

  /** Removes the move leading to the displayed position (and anything after it). */
  undo(): boolean {
    if (this.cursor === 0) return false
    this.cursor--
    this.moves.length = this.cursor
    this.boards.length = this.cursor + 1
    this.info.result = undefined
    return true
  }

  goTo(i: number) { this.cursor = Math.max(0, Math.min(this.moves.length, i)) }

  /** A variation sharing this record up to position `at` (boards are immutable), then `line` until its first refused move. */
  branch(at: number, line: (Vertex | null)[] = []): Game {
    const g = new Game(this.info) // the constructor copies info: play() clearing result stays on the branch
    g.moves = this.moves.slice(0, at); g.boards = this.boards.slice(0, at + 1); g.cursor = at
    for (const v of line) if (g.play(v) !== 'ok') break
    return g
  }

  /** Replays moves from a file without rule checks, so a slightly irregular SGF still loads. */
  static fromRecord(info: Partial<GameInfo> & { size: number }, moves: Move[]): Game {
    const g = new Game(info)
    for (const m of moves) {
      const prev = g.boards[g.boards.length - 1]
      g.boards.push(m.vertex ? prev.makeMove(m.sign, m.vertex) : passBoard(prev))
      g.moves.push(m)
    }
    g.cursor = moves.length
    return g
  }
}
