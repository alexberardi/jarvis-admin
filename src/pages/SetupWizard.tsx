import { cn } from '@/lib/utils'
import { WizardProvider, useWizard } from '@/context/WizardContext'
import { useNavigate } from 'react-router-dom'
import WelcomeStep from '@/components/wizard/WelcomeStep'
import HardwareStep from '@/components/wizard/HardwareStep'
import ServicesStep from '@/components/wizard/ServicesStep'
import ReviewStep from '@/components/wizard/ReviewStep'
import InstallStep from '@/components/wizard/InstallStep'
import LlmStep from '@/components/wizard/LlmStep'
import AccountStep from '@/components/wizard/AccountStep'

const STEPS = [
  { label: 'Welcome', component: WelcomeStep },
  { label: 'Hardware', component: HardwareStep },
  { label: 'Services', component: ServicesStep },
  { label: 'Review', component: ReviewStep },
  { label: 'Install', component: InstallStep },
  { label: 'LLM', component: LlmStep },
  { label: 'Account', component: AccountStep },
]

function WizardContent() {
  const { state, dispatch } = useWizard()
  const navigate = useNavigate()
  const StepComponent = STEPS[state.currentStep].component
  const isFirst = state.currentStep === 0
  const isLast = state.currentStep === STEPS.length - 1

  function handleNext() {
    if (isLast) {
      navigate('/login')
    } else {
      dispatch({ type: 'NEXT_STEP' })
    }
  }

  function handleBack() {
    dispatch({ type: 'PREV_STEP' })
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--color-background)] p-4">
      <div className="w-full max-w-2xl">
        {/* Step indicator */}
        <div className="mb-6 flex items-center justify-center gap-1">
          {STEPS.map((step, i) => (
            <button
              key={step.label}
              type="button"
              onClick={() => dispatch({ type: 'SET_STEP', step: i })}
              className="flex items-center gap-1"
            >
              <div
                className={cn(
                  'flex h-7 w-7 items-center justify-center rounded-full text-xs font-medium transition-colors',
                  i === state.currentStep
                    ? 'bg-[var(--color-primary)] text-white'
                    : i < state.currentStep
                      ? 'bg-[var(--color-primary)]/20 text-[var(--color-primary)]'
                      : 'bg-[var(--color-surface-alt)] text-[var(--color-text-muted)]',
                )}
              >
                {i + 1}
              </div>
              <span
                className={cn(
                  'hidden text-xs sm:inline',
                  i === state.currentStep
                    ? 'font-medium text-[var(--color-text)]'
                    : 'text-[var(--color-text-muted)]',
                )}
              >
                {step.label}
              </span>
              {i < STEPS.length - 1 && (
                <div
                  className={cn(
                    'mx-1 h-px w-4 sm:w-6',
                    i < state.currentStep
                      ? 'bg-[var(--color-primary)]/30'
                      : 'bg-[var(--color-border)]',
                  )}
                />
              )}
            </button>
          ))}
        </div>

        {/* Step content */}
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-lg">
          <StepComponent />
        </div>

        {/* Navigation */}
        <div className="mt-4 flex justify-between">
          <button
            type="button"
            onClick={handleBack}
            disabled={isFirst}
            className={cn(
              'rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm',
              'hover:bg-[var(--color-surface-alt)] transition-colors',
              'disabled:invisible',
            )}
          >
            Back
          </button>
          <button
            type="button"
            onClick={handleNext}
            className={cn(
              'rounded-lg bg-[var(--color-primary)] px-6 py-2 text-sm font-medium text-white',
              'hover:opacity-90 transition-opacity',
            )}
          >
            {isLast ? 'Finish' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function SetupWizard() {
  return (
    <WizardProvider>
      <WizardContent />
    </WizardProvider>
  )
}
