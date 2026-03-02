'use client';

interface StepIndicatorProps {
  currentStep: 1 | 2 | 3;
  className?: string;
}

const STEPS = [
  { label: 'Describe', icon: '🎙️' },
  { label: 'Upload', icon: '📷' },
  { label: 'Generate', icon: '✨' },
] as const;

/**
 * Horizontal 3-step progress indicator.
 * Steps: Describe → Upload → Generate
 */
export function StepIndicator({ currentStep, className = '' }: StepIndicatorProps) {
  return (
    <div className={`flex items-center justify-center gap-0 ${className}`}>
      {STEPS.map((step, idx) => {
        const stepNum = (idx + 1) as 1 | 2 | 3;
        const isActive = stepNum === currentStep;
        const isCompleted = stepNum < currentStep;
        const isFuture = stepNum > currentStep;

        return (
          <div key={step.label} className="flex items-center">
            {/* Step circle + label */}
            <div className="flex flex-col items-center gap-1">
              <div
                className={`
                  w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold
                  transition-all duration-300
                  ${isActive
                    ? 'bg-[#d4af37] text-black shadow-[0_0_12px_rgba(212,175,55,0.4)]'
                    : isCompleted
                      ? 'bg-[#d4af37]/20 text-[#d4af37] border border-[#d4af37]/40'
                      : 'bg-white/5 text-white/25 border border-white/10'
                  }
                `}
              >
                {isCompleted ? '✓' : stepNum}
              </div>
              <span
                className={`text-[10px] tracking-widest uppercase font-mono transition-colors duration-300 ${
                  isActive
                    ? 'text-[#d4af37]'
                    : isCompleted
                      ? 'text-[#d4af37]/50'
                      : 'text-white/20'
                }`}
              >
                {step.label}
              </span>
            </div>

            {/* Connecting line (skip after last step) */}
            {idx < STEPS.length - 1 && (
              <div
                className={`w-12 h-px mx-2 mb-4 transition-colors duration-300 ${
                  stepNum < currentStep ? 'bg-[#d4af37]/40' : 'bg-white/10'
                }`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
