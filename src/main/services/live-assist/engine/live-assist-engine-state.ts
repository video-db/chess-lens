export interface LiveAssistEngineState {
  engineSan?: string;
  engineLan?: string;
  engineFrom?: string;
  engineTo?: string;
  engineEval?: number;
  engineMate?: number | null;
}

export function engineStateFromContext(context?: LiveAssistEngineState | null): LiveAssistEngineState {
  return {
    engineSan: context?.engineSan,
    engineLan: context?.engineLan,
    engineFrom: context?.engineFrom,
    engineTo: context?.engineTo,
    engineEval: context?.engineEval,
    engineMate: context?.engineMate,
  };
}

export function emptyEngineState(): LiveAssistEngineState {
  return {
    engineSan: undefined,
    engineLan: undefined,
    engineFrom: undefined,
    engineTo: undefined,
    engineEval: undefined,
    engineMate: undefined,
  };
}

