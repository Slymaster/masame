// One synchronous gate for all KataGo callers. Epochs discard results started before an OGS takeover.
let blocked = false, epoch = 0
export const setAnalysisBlocked = (value: boolean) => { if (value !== blocked) { blocked = value; epoch++ } }
const denied = () => Object.assign(new Error('ogs_engine_blocked'), { code: 'ogs_engine_blocked' })
export const analysisTicket = () => { if (blocked) throw denied(); return epoch }
export const acceptAnalysis = (ticket: number) => { if (blocked || ticket !== epoch) throw denied() }
export const ogsAnalysisBlocked = (joining: boolean, phase: string | undefined, syncing: boolean) =>
  joining || (phase !== undefined && phase !== 'finished') || syncing
