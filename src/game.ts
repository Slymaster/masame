import GoBoard, { type Sign, type Vertex } from '@sabaki/go-board'

export type { Sign, Vertex }
/** vertex === null is a pass; `setup` marks the pseudo-move of a setup or empty node (sign: the side that does not play next). */
export interface Move { sign: Sign; vertex: Vertex | null; setup?: true }

/** A node of the record tree: its SGF properties as read, its move, its setup stones, its position once a shown line reached it. */
export interface GameNode {
  data: Record<string, string[]>
  children: GameNode[] // [0] = main line
  move?: Move // every node but the root
  stones?: [Vertex, Sign][] // AE as 0, AB, AW
  board?: GoBoard
}

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

/** The position after a node, without rule checks (a file may be slightly irregular): its setup stones, then its move. */
function after(prev: GoBoard, { move, stones }: GameNode): GoBoard {
  let b = prev
  if (stones) { b = passBoard(prev); for (const [v, s] of stones) b.set(v, s) }
  return move?.vertex ? b.makeMove(move.sign, move.vertex) : b !== prev || move?.setup ? b : passBoard(prev)
}

const same = (a: Vertex | null, b: Vertex | null) => a === b || (!!a && !!b && a[0] === b[0] && a[1] === b[1])

/**
 * A game record tree. `moves`, `boards` and `nodes` describe the current line (the shown variation, root first in
 * `nodes`, down its first children to a leaf): `boards[i]` is the position after `moves[0..i)`; `cursor` is the displayed position.
 */
export class Game {
  readonly info: GameInfo
  root: GameNode
  nodes: GameNode[]
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
    this.root = { data: {}, children: [], board }
    this.nodes = [this.root]
    this.boards = [board]
  }

  /** The line through `prefix`, extended along first children; boards are computed only here, on shown lines. */
  private setLine(prefix: GameNode[]) {
    const nodes = [...prefix]
    for (let n = nodes[nodes.length - 1]; n.children[0];) nodes.push(n = n.children[0])
    for (let i = 1; i < nodes.length; i++) nodes[i].board ??= after(nodes[i - 1].board!, nodes[i])
    this.nodes = nodes
    this.moves = nodes.slice(1).map(n => n.move!)
    this.boards = nodes.map(n => n.board!)
  }

  get board(): GoBoard { return this.boards[this.cursor] }
  get lastMove(): Move | null { const m = this.moves[this.cursor - 1]; return m && !m.setup ? m : null }
  get toPlay(): Sign { const m = this.moves[this.cursor - 1]; return m ? (-m.sign as Sign) : this.info.firstSign }
  /** The last two moves, pseudo-moves aside, are passes. */
  get ended(): boolean {
    let n = 0
    for (let i = this.cursor - 1; i >= 0 && n < 2; i--) if (!this.moves[i].setup) { if (this.moves[i].vertex) return false; n++ }
    return n === 2
  }
  get leaf(): GameNode { return this.nodes[this.nodes.length - 1] }
  /** The current line is the main line (first children all the way). */
  get onMain(): boolean { return this.nodes.every((n, i) => !i || this.nodes[i - 1].children[0] === n) }
  /** The nearest position at or before the cursor whose node has siblings: it is variation k of n (1-based). */
  get fork(): { at: number; k: number; n: number } | null {
    for (let at = this.cursor; at > 0; at--) {
      const sibs = this.nodes[at - 1].children
      if (sibs.length > 1) return { at, k: sibs.indexOf(this.nodes[at]) + 1, n: sibs.length }
    }
    return null
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
    const at = this.nodes[this.cursor]
    let node = at.children.find(c => !c.stones && c.move!.sign === sign && !c.move!.setup && same(c.move!.vertex, vertex))
    if (!node) {
      // the record changed: a loaded or validated result no longer describes it (a new variation leaves it)
      if (!at.children.length && this.onMain) this.info.result = undefined
      at.children.push(node = { data: {}, children: [], move: { sign, vertex }, board: next })
    }
    this.setLine([...this.nodes.slice(0, this.cursor + 1), node])
    this.cursor++
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

  /** Removes the node leading to the displayed position and its subtree; the line goes on along a remaining sibling. */
  undo(): boolean {
    if (this.cursor === 0) return false
    if (this.onMain) this.info.result = undefined
    const parent = this.nodes[this.cursor - 1]
    parent.children.splice(parent.children.indexOf(this.nodes[this.cursor]), 1)
    this.cursor--
    this.setLine(this.nodes.slice(0, this.cursor + 1))
    return true
  }

  goTo(i: number) { this.cursor = Math.max(0, Math.min(this.moves.length, i)) }

  /** The next (step 1) or previous sibling at the fork, wrapping; the cursor on its first move. */
  switchVariation(step: number) {
    const f = this.fork
    if (!f) return
    const sibs = this.nodes[f.at - 1].children
    this.setLine([...this.nodes.slice(0, f.at), sibs[(f.k - 1 + step % f.n + f.n) % f.n]])
    this.cursor = f.at
  }

  /** Back to the main line, the cursor on the last position it shares with the current one. */
  mainLine() {
    const i = this.nodes.findIndex((n, i) => i > 0 && this.nodes[i - 1].children[0] !== n)
    if (i < 0) return
    this.setLine([this.root])
    this.cursor = i - 1
  }

  /** The current line becomes the main line. */
  promote() {
    for (let i = 1; i < this.nodes.length; i++) {
      const sibs = this.nodes[i - 1].children
      sibs.unshift(...sibs.splice(sibs.indexOf(this.nodes[i]), 1))
    }
  }

  /** A detached variation sharing this line up to position `at` (data and boards), then `line` until its first refused move. */
  branch(at: number, line: (Vertex | null)[] = []): Game {
    const g = new Game(this.info) // the constructor copies info: play() clearing result stays on the branch
    const copy = this.nodes.slice(0, at + 1).map(({ data, move, stones, board }) => ({ data, move, stones, board, children: [] as GameNode[] }))
    copy.forEach((n, i) => i && copy[i - 1].children.push(n))
    g.root = copy[0]
    g.setLine([g.root])
    g.cursor = at
    for (const v of line) if (g.play(v) !== 'ok') break
    return g
  }

  /** A loaded tree; the root's board comes from info.setup. Shows the main line, at its end. */
  static fromTree(info: Partial<GameInfo> & { size: number }, root: GameNode): Game {
    const g = new Game(info)
    root.board = g.root.board
    g.root = root
    g.setLine([root])
    g.cursor = g.moves.length
    return g
  }

  /** Replays moves from a file without rule checks, so a slightly irregular SGF still loads. */
  static fromRecord(info: Partial<GameInfo> & { size: number }, moves: Move[]): Game {
    const nodes: GameNode[] = moves.map(move => ({ data: {}, children: [], move })), root: GameNode = { data: {}, children: nodes.slice(0, 1) }
    nodes.forEach((n, i) => i && nodes[i - 1].children.push(n))
    return Game.fromTree(info, root)
  }
}
