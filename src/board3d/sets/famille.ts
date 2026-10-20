// Heirloom set: the Japanese slate and shell, which age with your games (famille.gl.ts reads the patina). Same shape and
// sound; the 2D board shows them half aged: a warmer ivory shell.
import type { StoneData } from '../stoneSets'
import japonaise from './japonaise'

export default {
  ...japonaise,
  skin2d: {
    ...japonaise.skin2d,
    white: [[255, 251, 238], [246, 236, 214], [230, 214, 186], [214, 196, 164]],
  },
} satisfies StoneData
