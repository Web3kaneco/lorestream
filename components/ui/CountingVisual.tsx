'use client';

interface CountingVisualProps {
  problem: string; // e.g., "5 + 3 = ?", "4 x 6 = ?"
}

// Fun emoji objects for counting — deterministic per problem
const EMOJI_POOL = ['🍎', '⭐', '🟢', '🔵', '🟡', '🌸', '🎈', '🍪', '🐟', '🌺'];

/**
 * Parse a math problem string to extract two numbers and the operator.
 * Returns null for non-math problems (e.g., Spanish vocab questions).
 */
function parseMathProblem(problem: string): { a: number; op: string; b: number } | null {
  const match = problem.match(/(\d+)\s*([+\-x×÷*\/])\s*(\d+)/);
  if (!match) return null;
  const a = parseInt(match[1]);
  const b = parseInt(match[3]);
  if (isNaN(a) || isNaN(b)) return null;
  return { a, op: match[2], b };
}

/**
 * Pick a deterministic emoji based on the problem text.
 * Same problem always gets the same emoji.
 */
function pickEmoji(problem: string): string {
  let hash = 0;
  for (let i = 0; i < problem.length; i++) {
    hash = ((hash << 5) - hash) + problem.charCodeAt(i);
    hash |= 0;
  }
  return EMOJI_POOL[Math.abs(hash) % EMOJI_POOL.length];
}

function EmojiGroup({ count, emoji }: { count: number; emoji: string }) {
  // Arrange in rows of 5 for readability
  const rows: number[] = [];
  let remaining = count;
  while (remaining > 0) {
    rows.push(Math.min(remaining, 5));
    remaining -= 5;
  }

  return (
    <div className="flex flex-col items-center gap-1">
      {rows.map((rowCount, ri) => (
        <div key={ri} className="flex gap-1">
          {Array.from({ length: rowCount }).map((_, j) => (
            <span key={j} className="text-2xl leading-tight select-none">{emoji}</span>
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * Programmatic counting visual for math problems.
 * Renders exact emoji counts — 100% accurate, no AI image generation needed.
 * Returns null for non-math or too-large problems.
 */
export function CountingVisual({ problem }: CountingVisualProps) {
  const parsed = parseMathProblem(problem);
  if (!parsed) return null;

  const { a, op, b } = parsed;
  const emoji = pickEmoji(problem);
  const isMultiplication = op === 'x' || op === '×' || op === '*';
  const isDivision = op === '÷' || op === '/';

  // Skip for large numbers or division (hard to visualize)
  if (a > 30 || b > 30) return null;
  if (isDivision) return null;
  if (isMultiplication && a * b > 36) return null;

  // Multiplication: show A groups of B objects
  if (isMultiplication) {
    return (
      <div className="rounded-2xl overflow-hidden shadow-lg border" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-panel)' }}>
        <div className="flex items-center justify-between px-4 py-2" style={{ backgroundColor: 'var(--bg-secondary)' }}>
          <span className="text-xs font-bold tracking-wide" style={{ color: 'var(--accent)' }}>MATH</span>
          <span className="text-[10px] uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>Counting Aid</span>
        </div>
        <div className="p-4">
          <div className="flex flex-wrap justify-center gap-3">
            {Array.from({ length: a }).map((_, gi) => (
              <div key={gi} className="flex flex-col items-center p-2 rounded-lg" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px dashed var(--border)' }}>
                <EmojiGroup count={b} emoji={emoji} />
              </div>
            ))}
          </div>
          <p className="text-sm font-medium text-center mt-3" style={{ color: 'var(--text-secondary)' }}>
            {a} groups of {b}
          </p>
        </div>
      </div>
    );
  }

  // Addition or subtraction: show two groups side by side
  const opSymbol = op === '+' ? '+' : '−';

  return (
    <div className="rounded-2xl overflow-hidden shadow-lg border" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-panel)' }}>
      <div className="flex items-center justify-between px-4 py-2" style={{ backgroundColor: 'var(--bg-secondary)' }}>
        <span className="text-xs font-bold tracking-wide" style={{ color: 'var(--accent)' }}>MATH</span>
        <span className="text-[10px] uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>Counting Aid</span>
      </div>
      <div className="p-4 flex items-center justify-center gap-6">
        {/* Group A */}
        <div className="flex flex-col items-center">
          <EmojiGroup count={a} emoji={emoji} />
          <span className="text-sm font-bold mt-2" style={{ color: 'var(--text-secondary)' }}>{a}</span>
        </div>

        {/* Operator */}
        <span className="text-3xl font-bold" style={{ color: 'var(--accent)' }}>
          {opSymbol}
        </span>

        {/* Group B */}
        <div className="flex flex-col items-center">
          <EmojiGroup count={b} emoji={emoji} />
          <span className="text-sm font-bold mt-2" style={{ color: 'var(--text-secondary)' }}>{b}</span>
        </div>
      </div>
    </div>
  );
}
