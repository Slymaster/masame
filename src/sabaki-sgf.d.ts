// Minimal typings for the parts of @sabaki/sgf we use (the package ships none).
declare module '@sabaki/sgf' {
  export interface SgfNode { id?: number; data: Record<string, string[]>; children: SgfNode[] }
  export function tokenizeIter(contents: string): Iterable<{ type: string; value: string; pos: number }>
  export function parse(contents: string): SgfNode[]
  export function stringify(nodes: SgfNode[] | SgfNode): string
  export function parseCompressedVertices(input: string): [number, number][]
  export function parseVertex(input: string): [number, number]
  export function stringifyVertex(vertex: [number, number]): string
}
