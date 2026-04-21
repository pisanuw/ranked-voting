import { useState } from 'react'

export default function IRVRounds({ rounds, optionMap, totalVotes }) {
  const [activeRound, setActiveRound] = useState(0)

  if (!rounds || rounds.length === 0) return null

  const round = rounds[activeRound]
  const sortedEntries = Object.entries(round.counts)
    .sort(([, a], [, b]) => b - a)

  const maxCount = Math.max(...Object.values(round.counts), 1)

  return (
    <div className="card overflow-hidden space-y-0">
      {/* Header */}
      <div className="px-5 py-4 border-b border-slate-200">
        <h2 className="text-lg font-bold text-slate-800">IRV Simulation</h2>
        <p className="text-xs text-slate-500 mt-0.5">
          Instant Runoff Voting — candidates with fewest votes are eliminated each round until a winner emerges.
        </p>
      </div>

      {/* Round selector */}
      <div className="flex gap-1 px-4 py-3 bg-slate-50 border-b border-slate-100 overflow-x-auto">
        {rounds.map((r, i) => (
          <button
            key={i}
            onClick={() => setActiveRound(i)}
            className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
              activeRound === i
                ? 'bg-brand-600 text-white'
                : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            {r.winner
              ? `Round ${i + 1} 🏆`
              : `Round ${i + 1}`}
          </button>
        ))}
      </div>

      {/* Round detail */}
      <div className="px-5 py-4 space-y-4">
        {/* Round summary */}
        <div className="flex items-center gap-3 text-sm">
          <span className="text-slate-500">Round {activeRound + 1} of {rounds.length}</span>
          <span className="text-slate-300">·</span>
          <span className="text-slate-500">{round.total} ballot{round.total !== 1 ? 's' : ''} counted</span>
          {round.winner && (
            <>
              <span className="text-slate-300">·</span>
              <span className="text-green-700 font-medium">
                🏆 Winner: {optionMap[round.winner]?.title}
              </span>
            </>
          )}
          {round.eliminated && !round.winner && (
            <>
              <span className="text-slate-300">·</span>
              <span className="text-red-600 font-medium">
                ✕ Eliminated: {optionMap[round.eliminated]?.title}
              </span>
            </>
          )}
        </div>

        {/* Bar chart */}
        <div className="space-y-2">
          {sortedEntries.map(([optionId, count]) => {
            const option  = optionMap[optionId]
            const pct     = round.total > 0 ? (count / round.total) * 100 : 0
            const isWinner    = round.winner    === optionId
            const isEliminated = round.eliminated === optionId
            const majorityPct = 50

            return (
              <div key={optionId} className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <span className={`font-medium truncate max-w-xs ${
                    isWinner     ? 'text-green-700' :
                    isEliminated ? 'text-red-500 line-through' :
                    'text-slate-700'
                  }`}>
                    {isWinner    && '🏆 '}
                    {isEliminated && '✕ '}
                    {option?.title ?? optionId}
                  </span>
                  <span className="text-slate-500 text-xs ml-2 flex-shrink-0">
                    {count} vote{count !== 1 ? 's' : ''} ({pct.toFixed(1)}%)
                  </span>
                </div>

                {/* Bar */}
                <div className="relative h-5 bg-slate-100 rounded-full overflow-hidden">
                  {/* Majority marker */}
                  <div
                    className="absolute top-0 bottom-0 w-px bg-slate-400 z-10"
                    style={{ left: `${majorityPct}%` }}
                    title="50% majority threshold"
                  />
                  {/* Fill */}
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      isWinner     ? 'bg-green-500' :
                      isEliminated ? 'bg-red-300' :
                      'bg-brand-500'
                    }`}
                    style={{ width: `${(count / maxCount) * 100}%` }}
                  />
                </div>
              </div>
            )
          })}
        </div>

        {/* Majority line legend */}
        <p className="text-xs text-slate-400">
          The vertical line marks the 50% majority threshold. A candidate crossing it wins the round.
        </p>
      </div>

      {/* Navigation */}
      <div className="flex justify-between px-5 py-3 bg-slate-50 border-t border-slate-100">
        <button
          onClick={() => setActiveRound(r => Math.max(0, r - 1))}
          disabled={activeRound === 0}
          className="btn-secondary text-sm disabled:opacity-40"
        >
          ← Previous Round
        </button>
        <button
          onClick={() => setActiveRound(r => Math.min(rounds.length - 1, r + 1))}
          disabled={activeRound === rounds.length - 1}
          className="btn-secondary text-sm disabled:opacity-40"
        >
          Next Round →
        </button>
      </div>
    </div>
  )
}
