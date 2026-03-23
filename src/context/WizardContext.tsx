import { createContext, useContext, useReducer, type ReactNode, type Dispatch } from 'react'
import type { WizardState, WizardAction } from '@/types/wizard'

const TOTAL_STEPS = 7

const initialState: WizardState = {
  currentStep: 0,
  totalSteps: TOTAL_STEPS,
  enabledModules: [],
  portOverrides: {},
  infraPortOverrides: {},
  secrets: {},
  dbUser: 'jarvis',
  whisperModel: 'base.en',
  llmInterface: 'Qwen25MediumUntrained',
  deploymentMode: 'local',
  remoteLlmUrl: '',
  remoteWhisperUrl: '',
  platform: 'linux',
  hardware: null,
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function wizardReducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case 'SET_STEP':
      return { ...state, currentStep: clamp(action.step, 0, state.totalSteps - 1) }
    case 'NEXT_STEP':
      return { ...state, currentStep: Math.min(state.currentStep + 1, state.totalSteps - 1) }
    case 'PREV_STEP':
      return { ...state, currentStep: Math.max(state.currentStep - 1, 0) }
    case 'SET_ENABLED_MODULES':
      return { ...state, enabledModules: action.modules }
    case 'TOGGLE_MODULE': {
      if (action.enabled) {
        const modules = state.enabledModules.includes(action.serviceId)
          ? state.enabledModules
          : [...state.enabledModules, action.serviceId]
        return { ...state, enabledModules: modules }
      }
      return {
        ...state,
        enabledModules: state.enabledModules.filter((m) => m !== action.serviceId),
      }
    }
    case 'SET_PORT_OVERRIDE':
      return {
        ...state,
        portOverrides: { ...state.portOverrides, [action.serviceId]: action.port },
      }
    case 'SET_INFRA_PORT_OVERRIDE':
      return {
        ...state,
        infraPortOverrides: { ...state.infraPortOverrides, [action.infraId]: action.port },
      }
    case 'SET_SECRET':
      return {
        ...state,
        secrets: { ...state.secrets, [action.name]: action.value },
      }
    case 'SET_SECRETS':
      return { ...state, secrets: action.secrets }
    case 'SET_DB_USER':
      return { ...state, dbUser: action.user }
    case 'SET_WHISPER_MODEL':
      return { ...state, whisperModel: action.model }
    case 'SET_LLM_INTERFACE':
      return { ...state, llmInterface: action.interfaceId }
    case 'SET_DEPLOYMENT_MODE':
      return { ...state, deploymentMode: action.mode }
    case 'SET_REMOTE_LLM_URL':
      return { ...state, remoteLlmUrl: action.url }
    case 'SET_REMOTE_WHISPER_URL':
      return { ...state, remoteWhisperUrl: action.url }
    case 'SET_PLATFORM':
      return { ...state, platform: action.platform }
    case 'SET_HARDWARE':
      return { ...state, hardware: action.hardware, platform: action.hardware.platform }
    default:
      return state
  }
}

interface WizardContextValue {
  state: WizardState
  dispatch: Dispatch<WizardAction>
}

const WizardContext = createContext<WizardContextValue | null>(null)

export function WizardProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(wizardReducer, initialState)
  return (
    <WizardContext.Provider value={{ state, dispatch }}>
      {children}
    </WizardContext.Provider>
  )
}

export function useWizard(): WizardContextValue {
  const context = useContext(WizardContext)
  if (!context) {
    throw new Error('useWizard must be used within a WizardProvider')
  }
  return context
}
